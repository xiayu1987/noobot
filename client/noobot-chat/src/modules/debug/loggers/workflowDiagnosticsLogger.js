/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createDiagnosticsLogger } from "./createDiagnosticsLogger.js";

const logger = createDiagnosticsLogger("workflow-diagnostics");
export const setWorkflowDiagnosticsLogSink = logger.setSink;
export const isWorkflowDiagnosticsEnabled = logger.isEnabled;
export const logWorkflowDiagnostics = logger.log;

export function summarizeWorkflowMessage(message = {}, index = -1) {
  const payload = message?.pluginMeta?.payload || {};
  return {
    ...(index >= 0 ? { index } : {}),
    id: String(message?.id || message?.messageId || ""),
    role: String(message?.role || ""),
    type: String(message?.type || ""),
    pluginMessage: message?.pluginMessage === true,
    pluginSource: String(message?.pluginMeta?.source || ""),
    pluginKind: String(message?.pluginMeta?.kind || ""),
    pluginPhase: String(message?.pluginMeta?.phase || ""),
    sessionId: String(message?.sessionId || payload?.planningDialog?.sessionId || ""),
    dialogProcessId: String(
      message?.dialogProcessId || payload?.planningDialog?.dialogProcessId || "",
    ),
    turnScopeId: String(message?.turnScopeId || ""),
    workflowRunId: String(
      payload?.workflowRunId ||
        payload?.execution?.workflowRunId ||
        payload?.execution?.instanceId ||
        message?.workflowRunId ||
        "",
    ),
    contentLength: String(message?.content || "").length,
    presentationMessageId: String(
      message?.presentationMessageId || message?.messageId || message?.id || "",
    ),
    tagKeys: Array.isArray(message?.tags)
      ? message.tags.map((item) => String(item || ""))
      : Object.keys(message?.tags || {}),
  };
}

export function summarizeWorkflowMessages(messages = [], limit = 20) {
  const source = Array.isArray(messages) ? messages : [];
  const start = Math.max(0, source.length - Math.max(1, Number(limit) || 20));
  return source
    .slice(start)
    .map((message, index) => summarizeWorkflowMessage(message, start + index))
    .filter(
      (message) =>
        message.type === "workflow" ||
        message.pluginSource === "workflow-plugin" ||
        Boolean(message.workflowRunId) ||
        message.tagKeys.includes("message") ||
        (message.role.toLowerCase() === "assistant" &&
          message.type === "message" &&
          message.contentLength === 0 &&
          Boolean(message.turnScopeId || message.dialogProcessId)),
    );
}
