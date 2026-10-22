/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { getMessageRuntimeChannelState } from "../../chat/runtime/sessionRunStateMachine.js";
import { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
export { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
import { acceptsDebugSink, emitLazyDebugSafely } from "./lazyDebugSink.js";
import { isObjectLike } from "@noobot/shared/value";

let sessionLogSink = null;

export function setResendDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

export function summarizeDebugMessage(message = {}) {
  if (!isObjectLike(message)) return null;
  const channelState = getMessageRuntimeChannelState(message);
  return {
    messageUid: message.messageUid || "",
    presentationMessageId: message.presentationMessageId || "",
    role: message.role || message.type || "",
    turnScopeId: message.turnScopeId || message.owner?.turnScopeId || "",
    dialogProcessId: message.dialogProcessId || message.owner?.dialogProcessId || "",
    parentDialogProcessId: message.parentDialogProcessId || "",
    pending: message.pending === true,
    terminalOutcome: message.terminalOutcome || "",
    status: message.status || "",
    state: message.state || "",
    channelState: channelState?.state || "",
    thinkingStartedAt: message.thinkingStartedAt || "",
    thinkingFinishedAt: message.thinkingFinishedAt || "",
    contentLength: String(message.content || message.text || message.message || "").length,
    attachments: summarizeDebugAttachments(message.attachments),
  };
}

export function summarizeDebugMessages(messages = [], limit = 12) {
  if (!Array.isArray(messages)) return [];
  const start = Math.max(0, messages.length - limit);
  return messages.slice(start).map((message, offset) => ({
    index: start + offset,
    ...summarizeDebugMessage(message),
  }));
}

export function logResendDebug(phase, payload = {}) {
  return emitLazyDebugSafely(sessionLogSink, "resend", phase, payload);
}
