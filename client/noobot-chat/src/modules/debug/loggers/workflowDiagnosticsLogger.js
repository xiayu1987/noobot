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

function firstText(...values) {
  return String(values.find(Boolean) || "");
}

function summarizeTagKeys(tags) {
  return Array.isArray(tags) ? tags.map((item) => String(item || "")) : Object.keys(tags || {});
}

function summarizePluginFields(pluginMeta = {}) {
  return {
    pluginSource: firstText(pluginMeta.source),
    pluginKind: firstText(pluginMeta.kind),
    pluginPhase: firstText(pluginMeta.phase),
  };
}

function resolveWorkflowRunId(message, payload) {
  const execution = payload.execution || {};
  return firstText(
    payload.workflowRunId,
    execution.workflowRunId,
    execution.instanceId,
    message.workflowRunId,
  );
}

export function summarizeWorkflowMessage(message = {}, index = -1) {
  const source = message || {};
  const pluginMeta = source.pluginMeta || {};
  const payload = pluginMeta.payload || {};
  const planningDialog = payload.planningDialog || {};
  return {
    ...(index >= 0 ? { index } : {}),
    id: firstText(source.id, source.messageId),
    role: firstText(source.role),
    type: firstText(source.type),
    pluginMessage: source.pluginMessage === true,
    ...summarizePluginFields(pluginMeta),
    sessionId: firstText(source.sessionId, planningDialog.sessionId),
    dialogProcessId: firstText(source.dialogProcessId, planningDialog.dialogProcessId),
    turnScopeId: firstText(source.turnScopeId),
    workflowRunId: resolveWorkflowRunId(source, payload),
    contentLength: firstText(source.content).length,
    presentationMessageId: firstText(source.presentationMessageId, source.messageId, source.id),
    tagKeys: summarizeTagKeys(source.tags),
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
