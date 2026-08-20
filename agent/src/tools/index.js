/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./execution/file-tool.js";
import { createScriptTool } from "./execution/script-tool.js";
import { createNativeScriptTool } from "./execution/native-script-tool.js";
import { createSkillTool } from "./execution/skill-tool.js";
import { createServiceTool } from "./execution/service-tool.js";
import { createModelTool } from "./ai-models/model-tool.js";
import { createUserInteractionTool } from "./collaboration/user-interaction-tool.js";
import { createMcpTool } from "./execution/mcp-tool.js";
import { createConnectorAccessTool } from "./connectors/connector-access-tool.js";
import { createWebSearchTool } from "./ai-models/web-search-tool.js";
import { createMultimodalGenerateTool } from "./ai-models/multimodal-generate-tool.js";
import { createMultimodalParseTool } from "./ai-models/multimodal-parse-tool.js";
import { createTaskSummaryTool } from "./collaboration/task-summary-tool.js";
import { createTaskCheckTool } from "./collaboration/task-check-tool.js";
import { createRequestHelpTool } from "./collaboration/request-help-tool.js";
import { emitEvent } from "../events/index.js";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../config/index.js";
import { TOOL_CONFIG_ALIAS_KEY, TOOL_NAME } from "./constants/index.js";
import { runBuildToolsAdapter } from "./adapter.js";
import { assertToolPathContract } from "@noobot/path-resolver";
import {
  MODEL_MULTIMODAL_MODALITY,
  supportsModelMultimodalGeneration,
  supportsModelMultimodalParsing,
} from "@noobot/model-protocol";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getToolsFromAgentContext,
} from "../context/agent-context-accessor.js";
export {
  setToolBuilderAdapter,
  getToolBuilderAdapter,
  resetToolBuilderAdapter,
} from "./adapter.js";

const DEFAULT_MAX_SUB_AGENT_DEPTH = BUILTIN_THRESHOLDS.agentCollab.maxSubAgentDepth;
const BLOCKED_AGENT_COLLAB_TOOL_NAMES = new Set([
  TOOL_NAME.DELEGATE_TASK_ASYNC,
  TOOL_NAME.WAIT_ASYNC_TASK_RESULT,
  TOOL_NAME.PLAN_MULTI_TASK_COLLABORATION,
  "delegateTaskAsync",
  "waitAsyncTaskResult",
  "planMultiTaskCollaboration",
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
  [TOOL_NAME.READ_FILE]: [TOOL_NAME.READ_FILE, TOOL_CONFIG_ALIAS_KEY.FILE],
  [TOOL_NAME.WRITE_FILE]: [TOOL_NAME.WRITE_FILE, TOOL_CONFIG_ALIAS_KEY.FILE],
  [TOOL_NAME.SEARCH]: [TOOL_NAME.SEARCH, TOOL_CONFIG_ALIAS_KEY.FILE],
  [TOOL_NAME.PATCH_FILE]: [TOOL_NAME.PATCH_FILE, TOOL_CONFIG_ALIAS_KEY.FILE],
  [TOOL_NAME.EXECUTE_SCRIPT]: [TOOL_NAME.EXECUTE_SCRIPT],
  [TOOL_NAME.EXECUTE_NATIVE_SCRIPT]: [TOOL_NAME.EXECUTE_NATIVE_SCRIPT],
  [TOOL_NAME.LIST_SKILLS]: [TOOL_NAME.LIST_SKILLS, TOOL_CONFIG_ALIAS_KEY.SKILL],
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
  [TOOL_NAME.PROCESS_CONNECTOR_TOOL]: [TOOL_NAME.PROCESS_CONNECTOR_TOOL],
  [TOOL_NAME.ACCESS_CONNECTOR]: [TOOL_NAME.ACCESS_CONNECTOR],
  [TOOL_NAME.INSPECT_CONNECTORS]: [TOOL_NAME.INSPECT_CONNECTORS],
  [TOOL_NAME.WEB_SEARCH]: [TOOL_NAME.WEB_SEARCH],
  [TOOL_NAME.MULTIMODAL_GENERATE]: [TOOL_NAME.MULTIMODAL_GENERATE],
  [TOOL_NAME.MULTIMODAL_PARSE]: [TOOL_NAME.MULTIMODAL_PARSE],
  [TOOL_NAME.TASK_SUMMARY]: [TOOL_NAME.TASK_SUMMARY],
  [TOOL_NAME.TASK_CHECK]: [TOOL_NAME.TASK_CHECK],
  [TOOL_NAME.REQUEST_HELP]: [TOOL_NAME.REQUEST_HELP],
};

function filterToolsByConfigEnabled(tools = [], effectiveConfig = {}) {
  const source = Array.isArray(tools) ? tools : [];
  return source.filter((toolDefinition) => {
    const name = normalizeToolName(toolDefinition);
    const candidates =
      Array.isArray(TOOL_CONFIG_ALIASES[name]) && TOOL_CONFIG_ALIASES[name].length
        ? TOOL_CONFIG_ALIASES[name]
        : [name];
    return candidates.every((key) => isNamedToolEnabled(effectiveConfig, key, true));
  });
}

function hasEnabledMultimodalGenerationProvider(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  return Object.values(providers).some(
    (providerConfig) =>
      providerConfig?.enabled !== false &&
      supportsModelMultimodalGeneration(providerConfig, [MODEL_MULTIMODAL_MODALITY.IMAGE]),
  );
}

function hasEnabledMultimodalParsingProvider(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  return Object.values(providers).some(
    (providerConfig) =>
      providerConfig?.enabled !== false && supportsModelMultimodalParsing(providerConfig),
  );
}

function resolveMaxSubAgentDepth(_effectiveConfig = {}) {
  return DEFAULT_MAX_SUB_AGENT_DEPTH;
}

async function buildToolsDefault(ctx) {
  const runtime = getRuntimeFromAgentContext(ctx.agentContext);
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const allowUserInteraction = runtime?.systemRuntime?.config?.allowUserInteraction !== false;
  const enableMultimodalGenerateTool = hasEnabledMultimodalGenerationProvider(effectiveConfig);
  const enableMultimodalParseTool = hasEnabledMultimodalParsingProvider(effectiveConfig);
  const baseTools = [
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createNativeScriptTool(ctx),
    ...createSkillTool(ctx),
    ...createServiceTool(ctx),
    ...createMcpTool(ctx),
    ...createWebSearchTool(ctx),
    ...(enableMultimodalGenerateTool ? createMultimodalGenerateTool(ctx) : []),
    ...(enableMultimodalParseTool ? createMultimodalParseTool(ctx) : []),
    ...createConnectorAccessTool(ctx),
    ...createModelTool(ctx),
    ...createTaskSummaryTool(ctx),
    ...createTaskCheckTool(ctx),
    ...createRequestHelpTool(ctx),
    ...(allowUserInteraction ? createUserInteractionTool(ctx) : []),
  ];
  const enabledTools = filterToolsByConfigEnabled(baseTools, effectiveConfig);
  for (const tool of enabledTools) {
    if (tool?.metadata?.pathContract) assertToolPathContract(tool.metadata.pathContract);
  }
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
  const sourceTools = Array.isArray(tools) ? tools : getToolsFromAgentContext(agentContext);
  const runtime = getRuntimeFromAgentContext(agentContext);
  const identity = getSessionIdsFromAgentContext(agentContext);
  const sessionId = identity.sessionId;
  const parentSessionId = identity.parentSessionId;
  const userId = identity.userId;
  const sessionManager = runtime?.sessionManager || null;
  const maxSubAgentDepth = resolveMaxSubAgentDepth(effectiveConfig);
  const depthTargetSessionId = sessionId || parentSessionId;
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
    (toolDefinition) => !BLOCKED_AGENT_COLLAB_TOOL_NAMES.has(normalizeToolName(toolDefinition)),
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
