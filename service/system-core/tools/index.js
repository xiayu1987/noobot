/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./file-tool.js";
import { createWaitTool } from "./wait-tool.js";
import { createScriptTool } from "./script-tool.js";
import { createSkillTool } from "./skill-tool.js";
import { createContentProcessTool } from "./content-process-tool.js";
import { createServiceTool } from "./service-tool.js";
import { createAgentCollabTool } from "./agent-collab-tool.js";
import { createModelTool } from "./model-tool.js";
import { createUserInteractionTool } from "./user-interaction-tool.js";
import { createMcpTool } from "./mcp-tool.js";
import { createConnectorAccessTool } from "./connectors/connector-access-tool.js";
import { createMultimodalGenerateTool } from "./multimodal-generate-tool.js";
import { emitEvent } from "../event/index.js";
import { mergeConfig } from "../config/index.js";

const DEFAULT_MAX_SUB_AGENT_DEPTH = 1;
const BLOCKED_AGENT_COLLAB_TOOL_NAMES = new Set([
  "delegate_task_async",
  "wait_async_task_result",
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
  read_file: ["read_file", "file"],
  write_file: ["write_file", "file"],
  wait: ["wait"],
  execute_script: ["execute_script"],
  list_skills: ["list_skills", "skill"],
  set_skill_task: ["set_skill_task", "skill"],
  call_service: ["call_service", "service"],
  call_mcp_task: ["call_mcp_task", "mcp"],
  delegate_task_async: ["delegate_task_async", "agent_collab"],
  wait_async_task_result: ["wait_async_task_result", "agent_collab"],
  plan_multi_task_collaboration: [
    "plan_multi_task_collaboration",
    "agent_collab",
  ],
  switch_model: ["switch_model", "model"],
  user_interaction: ["user_interaction"],
  web_to_data: ["web_to_data"],
  doc_to_data: ["doc_to_data"],
  process_content_task: ["process_content_task"],
  process_connector_tool: ["process_connector_tool"],
  database_connect_connector: ["database_connect_connector"],
  terminal_connect_connector: ["terminal_connect_connector"],
  email_connect_connector: ["email_connect_connector"],
  access_connector: ["access_connector"],
  inspect_connectors: ["inspect_connectors"],
  multimodal_generate: ["multimodal_generate"],
};

function filterToolsByConfigEnabled(tools = [], effectiveConfig = {}) {
  const source = Array.isArray(tools) ? tools : [];
  return source.filter((toolDefinition) => {
    const name = normalizeToolName(toolDefinition);
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
    effectiveConfig?.tools?.delegate_task_async?.max_sub_agent_depth ??
      effectiveConfig?.tools?.delegate_task_async?.maxSubAgentDepth ??
      effectiveConfig?.tools?.delegate_task_async?.delegate_tool_parent_max_depth ??
      effectiveConfig?.tools?.delegate_task_async?.delegateToolParentMaxDepth ??
      effectiveConfig?.tools?.agent_collab?.max_sub_agent_depth ??
      effectiveConfig?.tools?.agent_collab?.maxSubAgentDepth ??
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
