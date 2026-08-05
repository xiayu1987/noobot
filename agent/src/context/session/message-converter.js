/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeTransferEnvelopesFromRecord(item = {}) {
  const seen = new Set();
  return (Array.isArray(item?.transferEnvelopes) ? item.transferEnvelopes : []).filter((envelope) => {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return false;
    const key = JSON.stringify(envelope);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function toConversationMessages(sessionRecords = []) {
  return (sessionRecords || []).map((item) => {
    const attachments = Array.isArray(item.attachments) ? item.attachments : [];
    const transferEnvelopes = normalizeTransferEnvelopesFromRecord(item);
    return {
      messageUid: String(item?.messageUid || "").trim(),
      role: item.role || "user",
      content: item.content || "",
      rawModelContent:
        typeof item?.rawModelContent === "string" ||
        Array.isArray(item?.rawModelContent)
          ? item.rawModelContent
          : null,
      type: item.type || "",
      userName: item.userName || "",
      sessionId: item.sessionId || "",
      parentSessionId: item.parentSessionId || "",
      dialogProcessId: item.dialogProcessId || item.dialogId || "",
      parentDialogProcessId: item.parentDialogProcessId || "",
      turnScopeId: item.turnScopeId || "",
      summarized: item.summarized === true,
      injectedMessage: item.injectedMessage === true,
      injectedBy: item.injectedBy || "",
      injectedMessageType: item.injectedMessageType || "",
      frontendUserMessage: item.frontendUserMessage === true,
      messageOrigin: item.messageOrigin || "",
      pluginMessage: item.pluginMessage === true,
      terminalHistoryProjection: item.terminalHistoryProjection === true,
      terminalHistoryExplanation: item.terminalHistoryExplanation === true,
      terminalStatus: item.terminalStatus || "",
      terminalReason: item.terminalReason || "",
      tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : [],
      tool_call_id: item.tool_call_id || "",
      modelAdditionalKwargs:
        item?.modelAdditionalKwargs &&
        typeof item.modelAdditionalKwargs === "object" &&
        !Array.isArray(item.modelAdditionalKwargs)
          ? item.modelAdditionalKwargs
          : null,
      modelResponseMetadata:
        item?.modelResponseMetadata &&
        typeof item.modelResponseMetadata === "object" &&
        !Array.isArray(item.modelResponseMetadata)
          ? item.modelResponseMetadata
          : null,
      ...(attachments.length ? { attachments } : {}),
      ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
    };
  });
}
