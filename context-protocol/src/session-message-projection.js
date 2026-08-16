/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function plainObjectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizeContextTransferEnvelopes(envelopes = []) {
  const seen = new Set();
  return (Array.isArray(envelopes) ? envelopes : []).filter((envelope) => {
    if (!plainObjectOrNull(envelope)) return false;
    const key = JSON.stringify(envelope);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function projectSessionRecordToContextMessage(record = {}) {
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const transferEnvelopes = normalizeContextTransferEnvelopes(record.transferEnvelopes);
  return {
    messageUid: String(record.messageUid || "").trim(),
    role: record.role || "user",
    content: record.content || "",
    rawModelContent:
      typeof record.rawModelContent === "string" || Array.isArray(record.rawModelContent)
        ? record.rawModelContent
        : null,
    type: record.type || "",
    userName: record.userName || "",
    sessionId: record.sessionId || "",
    parentSessionId: record.parentSessionId || "",
    dialogProcessId: record.dialogProcessId || "",
    parentDialogProcessId: record.parentDialogProcessId || "",
    turnScopeId: record.turnScopeId || "",
    summarized: record.summarized === true,
    injectedMessage: record.injectedMessage === true,
    injectedBy: record.injectedBy || "",
    injectedMessageType: record.injectedMessageType || "",
    frontendUserMessage: record.frontendUserMessage === true,
    messageOrigin: record.messageOrigin || "",
    pluginMessage: record.pluginMessage === true,
    terminalHistoryProjection: record.terminalHistoryProjection === true,
    terminalHistoryExplanation: record.terminalHistoryExplanation === true,
    terminalStatus: record.terminalStatus || "",
    terminalReason: record.terminalReason || "",
    tool_calls: Array.isArray(record.tool_calls) ? record.tool_calls : [],
    tool_call_id: record.tool_call_id || "",
    modelAdditionalKwargs: plainObjectOrNull(record.modelAdditionalKwargs),
    modelResponseMetadata: plainObjectOrNull(record.modelResponseMetadata),
    ...(attachments.length ? { attachments } : {}),
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

export function projectSessionRecordsToContextMessages(records = []) {
  return (Array.isArray(records) ? records : []).map(projectSessionRecordToContextMessage);
}
