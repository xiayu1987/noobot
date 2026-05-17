/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./execution/file-tool.js";
import { createWaitTool } from "./workflow/wait-tool.js";
import { createScriptTool } from "./execution/script-tool.js";
import { createSkillTool } from "./execution/skill-tool.js";
import { createContentProcessTool } from "./data-processing/content-process-tool.js";
import { createServiceTool } from "./execution/service-tool.js";
import { createAgentCollabTool } from "./workflow/agent-collab-tool.js";
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
import { ConnectorType, ToolConfigAliasKey, ToolName } from "./constants/index.js";

const DEFAULT_MAX_SUB_AGENT_DEPTH = 1;
const BLOCKED_AGENT_COLLAB_TOOL_NAMES = new Set([
  ToolName.DELEGATE_TASK_ASYNC,
  ToolName.WAIT_ASYNC_TASK_RESULT,
  "delegateTaskAsync",
  "waitAsyncTaskResult",
]);

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
  [ToolName.READ_FILE]: [ToolName.READ_FILE, ToolConfigAliasKey.FILE],
  [ToolName.WRITE_FILE]: [ToolName.WRITE_FILE, ToolConfigAliasKey.FILE],
  [ToolName.WAIT]: [ToolName.WAIT],
  [ToolName.EXECUTE_SCRIPT]: [ToolName.EXECUTE_SCRIPT],
  [ToolName.LIST_SKILLS]: [ToolName.LIST_SKILLS, ToolConfigAliasKey.SKILL],
  [ToolName.SET_SKILL_TASK]: [ToolName.SET_SKILL_TASK, ToolConfigAliasKey.SKILL],
  [ToolName.CALL_SERVICE]: [ToolName.CALL_SERVICE, ToolConfigAliasKey.SERVICE],
  [ToolName.CALL_MCP_TASK]: [ToolName.CALL_MCP_TASK, ToolConfigAliasKey.MCP],
  [ToolName.DELEGATE_TASK_ASYNC]: [
    ToolName.DELEGATE_TASK_ASYNC,
    ToolConfigAliasKey.AGENT_COLLAB,
  ],
  [ToolName.WAIT_ASYNC_TASK_RESULT]: [
    ToolName.WAIT_ASYNC_TASK_RESULT,
    ToolConfigAliasKey.AGENT_COLLAB,
  ],
  [ToolName.PLAN_MULTI_TASK_COLLABORATION]: [
    ToolName.PLAN_MULTI_TASK_COLLABORATION,
    ToolConfigAliasKey.AGENT_COLLAB,
  ],
  [ToolName.SWITCH_MODEL]: [ToolName.SWITCH_MODEL, ToolConfigAliasKey.MODEL],
  [ToolName.USER_INTERACTION]: [ToolName.USER_INTERACTION],
  [ToolName.WEB_TO_DATA]: [ToolName.WEB_TO_DATA],
  [ToolName.DOC_TO_DATA]: [ToolName.DOC_TO_DATA],
  [ToolName.PROCESS_CONTENT_TASK]: [ToolName.PROCESS_CONTENT_TASK],
  [ToolName.PROCESS_CONNECTOR_TOOL]: [ToolName.PROCESS_CONNECTOR_TOOL],
  [ToolName.DATABASE_CONNECT_CONNECTOR]: [ConnectorType.CONNECT_TOOL_NAME.DATABASE],
  [ToolName.TERMINAL_CONNECT_CONNECTOR]: [ConnectorType.CONNECT_TOOL_NAME.TERMINAL],
  [ToolName.EMAIL_CONNECT_CONNECTOR]: [ConnectorType.CONNECT_TOOL_NAME.EMAIL],
  [ToolName.ACCESS_CONNECTOR]: [ToolName.ACCESS_CONNECTOR],
  [ToolName.INSPECT_CONNECTORS]: [ToolName.INSPECT_CONNECTORS],
  [ToolName.MULTIMODAL_GENERATE]: [ToolName.MULTIMODAL_GENERATE],
  [ToolName.TASK_SUMMARY]: [ToolName.TASK_SUMMARY],
  [ToolName.REQUEST_HELP]: [ToolName.REQUEST_HELP],
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
    effectiveConfig?.tools?.[ToolName.DELEGATE_TASK_ASYNC]?.max_sub_agent_depth ??
      effectiveConfig?.tools?.[ToolName.DELEGATE_TASK_ASYNC]?.maxSubAgentDepth ??
      effectiveConfig?.tools?.[ToolName.DELEGATE_TASK_ASYNC]?.delegate_tool_parent_max_depth ??
      effectiveConfig?.tools?.[ToolName.DELEGATE_TASK_ASYNC]?.delegateToolParentMaxDepth ??
      effectiveConfig?.tools?.[ToolConfigAliasKey.AGENT_COLLAB]?.max_sub_agent_depth ??
      effectiveConfig?.tools?.[ToolConfigAliasKey.AGENT_COLLAB]?.maxSubAgentDepth ??
      0,
  );
  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return DEFAULT_MAX_SUB_AGENT_DEPTH;
  }
  return configuredValue;
}

export async function buildTools(ctx) {
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
    ...createWaitTool(ctx),
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createSkillTool(ctx),
    ...createContentProcessTool(ctx),
    ...createServiceTool(ctx),
    ...createMcpTool(ctx),
    ...(enableMultimodalGenerateTool ? createMultimodalGenerateTool(ctx) : []),
    ...createConnectorAccessTool(ctx),
    ...createAgentCollabTool(ctx),
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
  const parentSessionId = String(
    runtime?.systemRuntime?.parentSessionId || runtime?.parentSessionId || "",
  ).trim();
  const userId = String(runtime?.userId || "").trim();
  const sessionManager = runtime?.sessionManager || null;
  const maxSubAgentDepth = resolveMaxSubAgentDepth(effectiveConfig);

  if (!sessionManager || !userId) {
    return sourceTools;
  }

  const depthTargetSessionId = sessionId || parentSessionId;
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
