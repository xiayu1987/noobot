/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./file-tool.js";
import { createScriptTool } from "./script-tool.js";
import { createSkillTool } from "./skill-tool.js";
import { createContentProcessTool } from "./content-process-tool.js";
import { createServiceTool } from "./service-tool.js";
import { createAgentCollabTool } from "./agent-collab-tool.js";
import { createModelTool } from "./model-tool.js";
import { createUserInteractionTool } from "./user-interaction-tool.js";
import { createMcpTool } from "./mcp-tool.js";
import { emitEvent } from "../event/index.js";
import { mergeConfig } from "../config/index.js";

function isNamedToolEnabled(effectiveConfig = {}, toolName = "", defaultEnabled = true) {
  const normalized = String(toolName || "").trim();
  if (!normalized) return defaultEnabled;
  const toolConfig = effectiveConfig?.tools?.[normalized];
  if (!toolConfig || typeof toolConfig !== "object") return defaultEnabled;
  return toolConfig.enabled !== false;
}

const TOOL_CONFIG_ALIASES = {
  read_file: ["read_file", "file"],
  write_file: ["write_file", "file"],
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
};

function filterToolsByConfigEnabled(tools = [], effectiveConfig = {}) {
  const source = Array.isArray(tools) ? tools : [];
  return source.filter((toolDefinition) => {
    const name = String(toolDefinition?.name || "").trim();
    const candidates =
      Array.isArray(TOOL_CONFIG_ALIASES[name]) && TOOL_CONFIG_ALIASES[name].length
        ? TOOL_CONFIG_ALIASES[name]
        : [name];
    return candidates.every((key) =>
      isNamedToolEnabled(effectiveConfig, key, true),
    );
  });
}

export async function buildTools(ctx) {
  const runtime = ctx?.agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const allowUserInteraction =
    ctx?.agentContext?.runtime?.systemRuntime?.config?.allowUserInteraction !==
    false;
  const baseTools = [
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createSkillTool(ctx),
    ...createContentProcessTool(ctx),
    ...createServiceTool(ctx),
    ...createMcpTool(ctx),
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
    : Array.isArray(agentContext?.tools)
      ? agentContext.tools
      : [];
  const runtime = agentContext?.runtime || {};
  const parentSessionId = String(runtime?.parentSessionId || "").trim();
  const userId = String(runtime?.userId || "").trim();
  const sessionManager = runtime?.sessionManager || null;
  const configuredMaxParentDepth = Number(
    effectiveConfig?.tools?.delegate_task_async?.max_sub_agent_depth ??
      effectiveConfig?.tools?.delegate_task_async?.maxSubAgentDepth ??
      effectiveConfig?.tools?.delegate_task_async?.delegate_tool_parent_max_depth ??
      effectiveConfig?.tools?.delegate_task_async?.delegateToolParentMaxDepth ??
      effectiveConfig?.tools?.agent_collab?.max_sub_agent_depth ??
      effectiveConfig?.tools?.agent_collab?.maxSubAgentDepth ??
      0,
  );
  const maxParentDepth =
    Number.isFinite(configuredMaxParentDepth) && configuredMaxParentDepth > 0
      ? configuredMaxParentDepth
      : 1;

  if (!parentSessionId || !sessionManager || !userId) {
    return sourceTools;
  }

  let parentDepth = 0;
  try {
    parentDepth = Number(
      (await sessionManager.getSessionDepth({
        userId,
        sessionId: parentSessionId,
      })) || 0,
    );
  } catch {
    parentDepth = 0;
  }

  if (parentDepth < maxParentDepth) return sourceTools;

  const blockedToolNames = new Set([
    "delegate_task_async",
    "wait_async_task_result",
    "delegateTaskAsync",
    "waitAsyncTaskResult",
  ]);
  const filteredTools = sourceTools.filter(
    (toolDefinition) =>
      !blockedToolNames.has(String(toolDefinition?.name || "")),
  );

  if (filteredTools.length !== sourceTools.length) {
    emitEvent(eventListener, "agent_collab_tools_disabled_by_depth", {
      parentSessionId,
      parentDepth,
      maxParentDepth,
      disabledTools: Array.from(blockedToolNames),
    });
  }
  return filteredTools;
}
