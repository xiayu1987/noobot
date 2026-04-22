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

export async function buildTools(ctx) {
  const runtime = ctx?.agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const allowUserInteraction =
    ctx?.agentContext?.runtime?.systemRuntime?.config?.allowUserInteraction !==
    false;
  const processContentTaskEnabled =
    effectiveConfig?.tools?.process_content_task?.enabled !== false;
  const baseTools = [
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createSkillTool(ctx),
    ...(processContentTaskEnabled ? createContentProcessTool(ctx) : []),
    ...createServiceTool(ctx),
    ...createMcpTool(ctx),
    ...createAgentCollabTool(ctx),
    ...createModelTool(ctx),
    ...(allowUserInteraction ? createUserInteractionTool(ctx) : []),
  ];
  return await filterToolsByRuntimePolicy({
    agentContext: ctx?.agentContext || {},
    tools: baseTools,
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
    effectiveConfig?.async?.maxSubAgentDepth ??
      effectiveConfig?.async?.delegateToolParentMaxDepth ??
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
