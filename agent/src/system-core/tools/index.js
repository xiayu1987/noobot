/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./execution/file-tool.js";
import { createScriptTool } from "./execution/script-tool.js";
import { createSkillTool } from "./execution/skill-tool.js";
import { createContentProcessTool } from "./data-processing/content-process-tool.js";
import { createServiceTool } from "./execution/service-tool.js";
import { createModelTool } from "./ai-models/model-tool.js";
import { createUserInteractionTool } from "./workflow/user-interaction-tool.js";
import { createMcpTool } from "./execution/mcp-tool.js";
import { createConnectorAccessTool } from "./connectors/connector-access-tool.js";
import { createMultimodalGenerateTool } from "./ai-models/multimodal-generate-tool.js";
import { createTaskSummaryTool } from "./workflow/task-summary-tool.js";
import { createRequestHelpTool } from "./workflow/request-help-tool.js";
import {
  FINAL_ANSWER_TOOL_NAME,
  createFinalAnswerTool,
} from "./workflow/final-answer-tool.js";
import { emitEvent } from "../event/index.js";
import { mergeConfig } from "../config/index.js";
import { resolveForceToolCall } from "../utils/shared-utils.js";
import { CONNECTOR_TYPE, TOOL_CONFIG_ALIAS_KEY, TOOL_NAME } from "./constants/index.js";
import { runBuildToolsAdapter } from "./adapter.js";
import { resolveParentSessionId } from "../context/parent-session-id-resolver.js";
export {
  setToolBuilderAdapter,
  getToolBuilderAdapter,
  resetToolBuilderAdapter,
} from "./adapter.js";

const DEFAULT_MAX_SUB_AGENT_DEPTH = 1;
const BLOCKED_AGENT_COLLAB_TOOL_NAMES = new Set([
  TOOL_NAME.DELEGATE_TASK_ASYNC,
  TOOL_NAME.WAIT_ASYNC_TASK_RESULT,
  TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION,
  "delegateTaskAsync",
  "waitAsyncTaskResult",
  "planMultiTaskCollaboration",
]);

function isAgentCollabDisabledByRuntimePolicy(runtime = {}) {
  const runConfig =
    runtime?.runConfig && typeof runtime.runConfig === "object"
      ? runtime.runConfig
      : {};
  const toolPolicy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
      ? runConfig.toolPolicy
      : {};
  return (
    toolPolicy?.disableAgentCollabTools === true ||
    toolPolicy?.disable_agent_collab_tools === true
  );
}

function normalizeToolNameList(input = []) {
  return Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function resolveDeniedToolNamesByRuntimePolicy(runtime = {}) {
  const runConfig =
    runtime?.runConfig && typeof runtime.runConfig === "object"
      ? runtime.runConfig
      : {};
  const toolPolicy =
    runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object"
      ? runConfig.toolPolicy
      : {};
  // Canonical field: runConfig.toolPolicy.denyToolNames
  // Legacy aliases are accepted for transition compatibility.
  const denyToolNames = new Set([
    ...normalizeToolNameList(toolPolicy?.denyToolNames),
    ...normalizeToolNameList(toolPolicy?.deny_tool_names),
  ]);
  if (isAgentCollabDisabledByRuntimePolicy(runtime)) {
    for (const toolName of BLOCKED_AGENT_COLLAB_TOOL_NAMES) {
      denyToolNames.add(toolName);
    }
  }
  return denyToolNames;
}

function isNamedToolEnabled(effectiveConfig = {}, toolName = "", defaultEnabled = true) {
  const normalized = String(toolName || "").trim();
  if (!normalized) return defaultEnabled;
  const toolConfig = effectiveConfig?.tools?.[normalized];
  if (!toolConfig || typeof toolConfig !== "object") return defaultEnabled;
  return toolConfig.enabled !== false;
}

function normalizeToolName(toolDefinition = {}) {
  return String(toolDefinition?.name || "").trim();
}

const TOOL_CONFIG_ALIASES = {
  [TOOL_NAME.READ_FILE]: [TOOL_NAME.READ_FILE, TOOL_CONFIG_ALIAS_KEY.FILE],
  [TOOL_NAME.WRITE_FILE]: [TOOL_NAME.WRITE_FILE, TOOL_CONFIG_ALIAS_KEY.FILE],
  [TOOL_NAME.EXECUTE_SCRIPT]: [TOOL_NAME.EXECUTE_SCRIPT],
  [TOOL_NAME.LIST_SKILLS]: [TOOL_NAME.LIST_SKILLS, TOOL_CONFIG_ALIAS_KEY.SKILL],
  [TOOL_NAME.SET_SKILL_TASK]: [TOOL_NAME.SET_SKILL_TASK, TOOL_CONFIG_ALIAS_KEY.SKILL],
  [TOOL_NAME.CALL_SERVICE]: [TOOL_NAME.CALL_SERVICE, TOOL_CONFIG_ALIAS_KEY.SERVICE],
  [TOOL_NAME.CALL_MCP_TASK]: [TOOL_NAME.CALL_MCP_TASK, TOOL_CONFIG_ALIAS_KEY.MCP],
  [TOOL_NAME.DELEGATE_TASK_ASYNC]: [
    TOOL_NAME.DELEGATE_TASK_ASYNC,
    TOOL_CONFIG_ALIAS_KEY.AGENT_COLLAB,
  ],
  [TOOL_NAME.WAIT_ASYNC_TASK_RESULT]: [
    TOOL_NAME.WAIT_ASYNC_TASK_RESULT,
    TOOL_CONFIG_ALIAS_KEY.AGENT_COLLAB,
  ],
  [TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION]: [
    TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION,
    TOOL_CONFIG_ALIAS_KEY.AGENT_COLLAB,
  ],
  [TOOL_NAME.SWITCH_MODEL]: [TOOL_NAME.SWITCH_MODEL, TOOL_CONFIG_ALIAS_KEY.MODEL],
  [TOOL_NAME.USER_INTERACTION]: [TOOL_NAME.USER_INTERACTION],
  [TOOL_NAME.WEB_TO_DATA]: [TOOL_NAME.WEB_TO_DATA],
  [TOOL_NAME.DOC_TO_DATA]: [TOOL_NAME.DOC_TO_DATA],
  [TOOL_NAME.PROCESS_CONTENT_TASK]: [TOOL_NAME.PROCESS_CONTENT_TASK],
  [TOOL_NAME.PROCESS_CONNECTOR_TOOL]: [TOOL_NAME.PROCESS_CONNECTOR_TOOL],
  [TOOL_NAME.DATABASE_CONNECT_CONNECTOR]: [CONNECTOR_TYPE.CONNECT_TOOL_NAME.DATABASE],
  [TOOL_NAME.TERMINAL_CONNECT_CONNECTOR]: [CONNECTOR_TYPE.CONNECT_TOOL_NAME.TERMINAL],
  [TOOL_NAME.EMAIL_CONNECT_CONNECTOR]: [CONNECTOR_TYPE.CONNECT_TOOL_NAME.EMAIL],
  [TOOL_NAME.ACCESS_CONNECTOR]: [TOOL_NAME.ACCESS_CONNECTOR],
  [TOOL_NAME.INSPECT_CONNECTORS]: [TOOL_NAME.INSPECT_CONNECTORS],
  [TOOL_NAME.MULTIMODAL_GENERATE]: [TOOL_NAME.MULTIMODAL_GENERATE],
  [TOOL_NAME.TASK_SUMMARY]: [TOOL_NAME.TASK_SUMMARY],
  [TOOL_NAME.REQUEST_HELP]: [TOOL_NAME.REQUEST_HELP],
};

function filterToolsByConfigEnabled(tools = [], effectiveConfig = {}) {
  const source = Array.isArray(tools) ? tools : [];
  return source.filter((toolDefinition) => {
    const name = normalizeToolName(toolDefinition);
    if (name === FINAL_ANSWER_TOOL_NAME) return true;
    const candidates =
      Array.isArray(TOOL_CONFIG_ALIASES[name]) && TOOL_CONFIG_ALIASES[name].length
        ? TOOL_CONFIG_ALIASES[name]
        : [name];
    return candidates.every((key) =>
      isNamedToolEnabled(effectiveConfig, key, true),
    );
  });
}

function hasEnabledMultimodalGenerationProvider(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  for (const providerConfig of Object.values(providers)) {
    if (!providerConfig || typeof providerConfig !== "object") continue;
    if (providerConfig.enabled === false) continue;
    const multimodalGeneration =
      providerConfig?.multimodal_generation &&
      typeof providerConfig.multimodal_generation === "object"
        ? providerConfig.multimodal_generation
        : {};
    const supportGeneration =
      multimodalGeneration?.support_generation &&
      typeof multimodalGeneration.support_generation === "object"
        ? multimodalGeneration.support_generation
        : {};
    const generationEnabled = supportGeneration?.enabled === true;
    if (!generationEnabled) continue;
    const supportScope = Array.isArray(supportGeneration?.support_scope)
      ? supportGeneration.support_scope.map((scopeItem) =>
          String(scopeItem || "").trim().toLowerCase(),
        )
      : [];
    if (supportScope.includes("image")) return true;
  }
  return false;
}

function resolveMaxSubAgentDepth(effectiveConfig = {}) {
  const configuredValue = Number(
    effectiveConfig?.tools?.[TOOL_NAME.DELEGATE_TASK_ASYNC]?.max_sub_agent_depth ??
      effectiveConfig?.tools?.[TOOL_NAME.DELEGATE_TASK_ASYNC]?.maxSubAgentDepth ??
      effectiveConfig?.tools?.[TOOL_NAME.DELEGATE_TASK_ASYNC]?.delegate_tool_parent_max_depth ??
      effectiveConfig?.tools?.[TOOL_NAME.DELEGATE_TASK_ASYNC]?.delegateToolParentMaxDepth ??
      effectiveConfig?.tools?.[TOOL_CONFIG_ALIAS_KEY.AGENT_COLLAB]?.max_sub_agent_depth ??
      effectiveConfig?.tools?.[TOOL_CONFIG_ALIAS_KEY.AGENT_COLLAB]?.maxSubAgentDepth ??
      0,
  );
  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return DEFAULT_MAX_SUB_AGENT_DEPTH;
  }
  return configuredValue;
}

async function buildToolsDefault(ctx) {
  const runtime =
    ctx?.agentContext?.runtime ||
    ctx?.agentContext?.execution?.controllers?.runtime ||
    {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const allowUserInteraction =
    ctx?.agentContext?.runtime?.systemRuntime?.config?.allowUserInteraction !==
    false;
  const forceTool = resolveForceToolCall(
    ctx?.agentContext?.runtime?.systemRuntime?.config || {},
  );
  const enableMultimodalGenerateTool = hasEnabledMultimodalGenerationProvider(
    effectiveConfig,
  );
  const baseTools = [
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createSkillTool(ctx),
    ...createContentProcessTool(ctx),
    ...createServiceTool(ctx),
    ...createMcpTool(ctx),
    ...(enableMultimodalGenerateTool ? createMultimodalGenerateTool(ctx) : []),
    ...createConnectorAccessTool(ctx),
    // Multi-agent collaboration tools are intentionally not registered here.
    // This is a hard disable at the agent registry level, independent of config/runtime policy.
    ...createModelTool(ctx),
    ...createTaskSummaryTool(ctx),
    ...createRequestHelpTool(ctx),
    ...(forceTool ? createFinalAnswerTool(ctx) : []),
    ...(allowUserInteraction ? createUserInteractionTool(ctx) : []),
  ];
  const enabledTools = filterToolsByConfigEnabled(baseTools, effectiveConfig);
  return await filterToolsByRuntimePolicy({
    agentContext: ctx?.agentContext || {},
    tools: enabledTools,
    effectiveConfig,
    eventListener: runtime?.eventListener || null,
  });
}

export async function buildTools(ctx) {
  return runBuildToolsAdapter(ctx, buildToolsDefault);
}

async function filterToolsByRuntimePolicy({
  agentContext,
  tools,
  effectiveConfig,
  eventListener = null,
}) {
  const sourceTools = Array.isArray(tools)
    ? tools
    : Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
  const runtime =
    agentContext?.runtime || agentContext?.execution?.controllers?.runtime || {};
  const sessionId = String(
    runtime?.systemRuntime?.sessionId || runtime?.sessionId || "",
  ).trim();
  const parentSessionId = resolveParentSessionId({ runtime });
  const userId = String(runtime?.userId || "").trim();
  const sessionManager = runtime?.sessionManager || null;
  const maxSubAgentDepth = resolveMaxSubAgentDepth(effectiveConfig);
  const depthTargetSessionId = sessionId || parentSessionId;
  const collabDisabledByLegacyPolicy = isAgentCollabDisabledByRuntimePolicy(runtime);
  const deniedToolNames = resolveDeniedToolNamesByRuntimePolicy(runtime);

  if (deniedToolNames.size) {
    const filteredTools = sourceTools.filter(
      (toolDefinition) => !deniedToolNames.has(normalizeToolName(toolDefinition)),
    );
    if (filteredTools.length !== sourceTools.length) {
      emitEvent(eventListener, "tools_disabled_by_runtime_policy", {
        sessionId: depthTargetSessionId,
        parentSessionId,
        disabledTools: Array.from(deniedToolNames),
      });
      if (collabDisabledByLegacyPolicy) {
        emitEvent(eventListener, "agent_collab_tools_disabled_by_runtime_policy", {
          sessionId: depthTargetSessionId,
          parentSessionId,
          disabledTools: Array.from(BLOCKED_AGENT_COLLAB_TOOL_NAMES),
        });
      }
    }
    return filteredTools;
  }

  if (!sessionManager || !userId) {
    return sourceTools;
  }

  if (!depthTargetSessionId) return sourceTools;

  let currentDepth = 0;
  try {
    currentDepth = Number(
      (await sessionManager.getSessionDepth({
        userId,
        sessionId: depthTargetSessionId,
      })) || 0,
    );
  } catch {
    currentDepth = 0;
  }

  if (currentDepth < maxSubAgentDepth) return sourceTools;

  const filteredTools = sourceTools.filter(
    (toolDefinition) =>
      !BLOCKED_AGENT_COLLAB_TOOL_NAMES.has(normalizeToolName(toolDefinition)),
  );

  if (filteredTools.length !== sourceTools.length) {
    emitEvent(eventListener, "agent_collab_tools_disabled_by_depth", {
      sessionId: depthTargetSessionId,
      parentSessionId,
      currentDepth,
      maxSubAgentDepth,
      disabledTools: Array.from(BLOCKED_AGENT_COLLAB_TOOL_NAMES),
    });
  }
  return filteredTools;
}
