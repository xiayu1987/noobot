/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { firstText } from "@noobot/shared/value";
import { createDiagnosticsLogger } from "./createDiagnosticsLogger.js";

const logger = createDiagnosticsLogger("workflow-diagnostics");
export const setWorkflowDiagnosticsLogSink = logger.setSink;
export const isWorkflowDiagnosticsEnabled = logger.isEnabled;
export const logWorkflowDiagnostics = logger.log;

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

export function summarizeWorkflowMessage(message = {}, index = -1) {
  const source = message || {};
  const pluginMeta = source.pluginMeta || {};
  const payload = pluginMeta.payload || {};
  const runMeta = payload.runMeta || {};
  return {
    ...(index >= 0 ? { index } : {}),
    messageUid: firstText(source.messageUid),
    role: firstText(source.role),
    type: firstText(source.type),
    pluginMessage: source.pluginMessage === true,
    ...summarizePluginFields(pluginMeta),
    sessionId: firstText(runMeta.sessionId),
    dialogProcessId: firstText(runMeta.dialogProcessId),
    turnScopeId: firstText(source.turnScopeId),
    workflowRunId: firstText(payload.workflowRunId),
    contentLength: firstText(source.content).length,
    presentationMessageId: firstText(source.presentationMessageId),
    tagKeys: summarizeTagKeys(source.tags),
  };
}
