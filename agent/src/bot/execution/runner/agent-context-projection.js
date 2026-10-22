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
import { isPlainObject, text } from "@noobot/shared/value";

export function requirePreparedAgentTurnExecution(prepared) {
  if (!isPlainObject(prepared?.agentContext)) {
    throw new TypeError("prepared agent turn execution requires agentContext");
  }
  if (!Array.isArray(prepared.userMessageAttachments)) {
    throw new TypeError("prepared agent turn execution requires userMessageAttachments");
  }
  return {
    agentContext: prepared.agentContext,
    userMessageAttachments: prepared.userMessageAttachments,
  };
}

export function buildAgentContextSummary(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const context = getAgentContextEnvelope(agentContext);
  const systemRuntime = getSystemRuntimeFromAgentContext(agentContext);
  const userMessageAttachments = runtime.userMessageAttachments;
  const runtimeAttachments = runtime.attachments;
  return {
    userId: context.identity.userId,
    sessionId: context.identity.sessionId,
    parentSessionId: context.identity.parentSessionId,
    dialogProcessId: getDialogProcessIdFromAgentContext(agentContext),
    caller: text(systemRuntime?.caller),
    runtimeModel: text(runtime?.runtimeModel),
    messageCount: context.modelContext.messageBlocks.history.length,
    toolCount: getToolsFromAgentContext(agentContext).length,
    attachmentCount: userMessageAttachments.length + runtimeAttachments.length,
    hasAbortSignal: Boolean(runtime?.abortSignal),
  };
}
