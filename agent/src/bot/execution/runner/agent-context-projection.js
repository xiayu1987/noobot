/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getAgentContextEnvelope,
  getDialogProcessIdFromAgentContext,
  getRuntimeFromAgentContext,
  getSystemRuntimeFromAgentContext,
  getToolsFromAgentContext,
} from "../../../context/agent-context-accessor.js";

export function normalizePreparedAgentTurnExecution(prepared = {}) {
  const source = prepared && typeof prepared === "object" ? prepared : {};
  const agentContext =
    source?.agentContext && typeof source.agentContext === "object" ? source.agentContext : {};
  return {
    runtimeAgentContext:
      source?.runtimeAgentContext && typeof source.runtimeAgentContext === "object"
        ? source.runtimeAgentContext
        : agentContext,
    userMessageAttachments: Array.isArray(source?.userMessageAttachments)
      ? source.userMessageAttachments
      : [],
  };
}

export function buildAgentContextSummary(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const context = getAgentContextEnvelope(agentContext);
  const systemRuntime = getSystemRuntimeFromAgentContext(agentContext);
  const userMessageAttachments = Array.isArray(runtime?.userMessageAttachments)
    ? runtime.userMessageAttachments
    : [];
  const runtimeAttachments = Array.isArray(runtime?.attachments) ? runtime.attachments : [];
  return {
    userId: context.identity.userId,
    sessionId: context.identity.sessionId,
    parentSessionId: context.identity.parentSessionId,
    dialogProcessId: getDialogProcessIdFromAgentContext(agentContext),
    caller: String(systemRuntime?.caller || "").trim(),
    runtimeModel: String(runtime?.runtimeModel || "").trim(),
    messageCount: context.modelContext.messageBlocks.history.length,
    toolCount: getToolsFromAgentContext(agentContext).length,
    attachmentCount: userMessageAttachments.length + runtimeAttachments.length,
    hasAbortSignal: Boolean(runtime?.abortSignal),
  };
}
