/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function trim(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return trim(value).toLowerCase();
}

function stringifyMessageContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (!isPlainObject(item)) return "";
        return trim(item.text || item.content || item.value);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasFrontendUserMarker(messageItem = {}) {
  return Boolean(
    messageItem?.frontendUserMessage === true ||
      messageItem?.additional_kwargs?.frontendUserMessage === true ||
      messageItem?.lc_kwargs?.frontendUserMessage === true ||
      messageItem?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  );
}

function normalizeRoleAlias(value = "") {
  const normalized = lower(value);
  if (!normalized) return "";
  if (["user", "human"].includes(normalized)) return "user";
  if (["assistant", "ai", "bot"].includes(normalized)) return "assistant";
  if (["tool", "function"].includes(normalized)) return "tool";
  return normalized;
}

function getLangChainMessageKind(messageItem = {}) {
  const idParts = [];
  if (Array.isArray(messageItem?.lc_id)) idParts.push(...messageItem.lc_id);
  if (Array.isArray(messageItem?.id)) idParts.push(...messageItem.id);
  const serializedName = trim(messageItem?.name || messageItem?.lc_name);
  if (serializedName) idParts.push(serializedName);
  const serializedType = trim(
    messageItem?.type === "constructor" ? "" : messageItem?.type,
  );
  if (serializedType) idParts.push(serializedType);
  const haystack = idParts.map((part) => lower(part)).join("|");
  if (!haystack) return "";
  if (haystack.includes("humanmessage") || /\bhuman\b/.test(haystack)) return "user";
  if (haystack.includes("aimessage") || /\bai\b/.test(haystack)) return "assistant";
  if (haystack.includes("toolmessage") || /\btool\b/.test(haystack)) return "tool";
  return "";
}

function hasTurnOwner(owner = {}) {
  return Boolean(owner.sessionId || owner.turnScopeId || owner.dialogProcessId || owner.role);
}

export function getMessageSessionId(messageItem = {}) {
  return trim(messageItem?.sessionId || messageItem?.session_id || messageItem?.backendSessionId);
}

export function normalizeTurnOwner(raw = {}) {
  const owner = isPlainObject(raw?.owner) ? raw.owner : {};
  return {
    sessionId: getMessageSessionId(owner) || getMessageSessionId(raw),
    turnScopeId: trim(owner?.turnScopeId),
    dialogProcessId: trim(owner?.dialogProcessId || owner?.dialog_process_id || raw?.ownerDialogProcessId),
    role: trim(owner?.role),
  };
}

export function normalizeTurnMeta(raw = {}) {
  const owner = normalizeTurnOwner(raw);
  const normalized = {
    sessionId: getMessageSessionId(raw),
    turnScopeId: trim(raw?.turnScopeId),
    dialogProcessId: trim(raw?.dialogProcessId || raw?.dialog_process_id || raw?.dialogId),
    parentDialogProcessId: trim(
      raw?.parentDialogProcessId || raw?.parent_dialog_process_id || raw?.parentDialogId,
    ),
  };
  if (hasTurnOwner(owner)) normalized.owner = owner;
  return normalized;
}

export function getMessageRole(messageItem = {}) {
  const explicitRole = normalizeRoleAlias(
    messageItem?.role ||
      messageItem?.messageRole ||
      messageItem?.message_role ||
      messageItem?.authorRole ||
      messageItem?.author_role ||
      messageItem?.senderRole ||
      messageItem?.sender_role,
  );
  if (explicitRole) return explicitRole;
  if (hasFrontendUserMarker(messageItem)) return "user";
  return getLangChainMessageKind(messageItem);
}

export function getMessageDialogProcessId(messageItem = {}) {
  return normalizeTurnMeta(messageItem).dialogProcessId;
}

export function getMessageParentDialogProcessId(messageItem = {}) {
  return normalizeTurnMeta(messageItem).parentDialogProcessId;
}

export function getMessageTurnScopeId(messageItem = {}) {
  return normalizeTurnMeta(messageItem).turnScopeId;
}

export function getMessageTurnScopeKey(messageItem = {}) {
  const sessionId = getMessageSessionId(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  return sessionId && turnScopeId ? `${sessionId}::${turnScopeId}` : "";
}

export function isAssistantWithoutTurnScope(messageItem = {}) {
  return getMessageRole(messageItem) === "assistant" && !getMessageTurnScopeId(messageItem);
}

export function canUseTurnScopedAssets(messageItem = {}) {
  return !isAssistantWithoutTurnScope(messageItem);
}

export function clearTurnScopedAssets(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return messageItem;
  messageItem.attachmentMetas = [];
  messageItem.completedToolLogs = [];
  messageItem.realtimeLogs = [];
  messageItem.executionLogTotal = 0;
  messageItem.processRealtimeLogs = [];
  messageItem.processCompletedToolLogs = [];
  messageItem.processExecutionLogTotal = 0;
  return messageItem;
}

export function getMessageStableId(messageItem = {}) {
  return trim(messageItem?.id);
}

export function getMessageContentIdentity(messageItem = {}) {
  return trim(
    stringifyMessageContent(
      messageItem?.content ??
        messageItem?.text ??
        messageItem?.lc_kwargs?.content ??
        messageItem?.kwargs?.content,
    ),
  );
}

export function buildMessageIdentityKey(messageItem = {}) {
  return [
    getMessageRole(messageItem),
    getMessageTurnScopeId(messageItem),
    getMessageDialogProcessId(messageItem),
    getMessageContentIdentity(messageItem),
  ].join("|");
}

export function hasMessageTurnScopeConflict(leftMessage = {}, rightMessage = {}) {
  const leftTurnScopeId = getMessageTurnScopeId(leftMessage);
  const rightTurnScopeId = getMessageTurnScopeId(rightMessage);
  return Boolean(leftTurnScopeId && rightTurnScopeId && leftTurnScopeId !== rightTurnScopeId);
}

export function hasExplicitMessageIdentity(messageItem = {}) {
  return Boolean(
    getMessageTurnScopeId(messageItem) ||
      getMessageStableId(messageItem) ||
      messageItem?.ts !== undefined ||
      getMessageDialogProcessId(messageItem),
  );
}

export function isSameMessageIdentity(targetMessage = {}, candidateMessage = {}) {
  if (!targetMessage || !candidateMessage) return false;
  if (targetMessage === candidateMessage) return true;

  const targetRole = lower(getMessageRole(targetMessage));
  const candidateRole = lower(getMessageRole(candidateMessage));
  if (targetRole && candidateRole && targetRole !== candidateRole) return false;

  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  if (targetTurnScopeId) {
    return getMessageTurnScopeId(candidateMessage) === targetTurnScopeId;
  }

  const targetId = getMessageStableId(targetMessage);
  if (targetId) {
    return getMessageStableId(candidateMessage) === targetId;
  }

  const targetTs = targetMessage?.ts;
  if (targetTs !== undefined && targetTs !== null) {
    return candidateMessage?.ts === targetTs;
  }

  const targetDialogProcessId = getMessageDialogProcessId(targetMessage);
  if (targetDialogProcessId) {
    return (
      getMessageDialogProcessId(candidateMessage) === targetDialogProcessId &&
      (!targetRole || candidateRole === targetRole)
    );
  }

  const targetContent = getMessageContentIdentity(targetMessage);
  return Boolean(
    targetRole &&
      targetContent &&
      lower(getMessageRole(candidateMessage)) === targetRole &&
      getMessageContentIdentity(candidateMessage) === targetContent
  );
}

export function findMessageIdentityIndex(targetMessage = {}, messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  return source.findIndex((message) => isSameMessageIdentity(targetMessage, message));
}

export function buildMessageAnchor(targetMessage = {}) {
  const turnScopeId = getMessageTurnScopeId(targetMessage);
  if (turnScopeId) return { turnScopeId };
  if (targetMessage?.ts !== undefined && targetMessage?.ts !== null) return { ts: targetMessage.ts };
  return {};
}

export function getMessageExplicitTurnIdentity(messageItem = {}) {
  return trim(getMessageTurnScopeId(messageItem));
}

export function isSameMessageRound(targetMessage = {}, candidateMessage = {}) {
  const targetTurnScopeKey = getMessageTurnScopeKey(targetMessage);
  const candidateTurnScopeKey = getMessageTurnScopeKey(candidateMessage);
  if (targetTurnScopeKey && candidateTurnScopeKey) {
    return targetTurnScopeKey === candidateTurnScopeKey;
  }

  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  const candidateTurnScopeId = getMessageTurnScopeId(candidateMessage);
  if (targetTurnScopeId && candidateTurnScopeId) {
    const targetSessionId = getMessageSessionId(targetMessage);
    const candidateSessionId = getMessageSessionId(candidateMessage);
    if (targetSessionId && candidateSessionId && targetSessionId !== candidateSessionId) return false;
    return targetTurnScopeId === candidateTurnScopeId;
  }
  return false;
}

export function isSameExplicitMessageTurn(leftMessage = {}, rightMessage = {}) {
  const leftIdentity = getMessageExplicitTurnIdentity(leftMessage);
  const rightIdentity = getMessageExplicitTurnIdentity(rightMessage);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

export function shouldCollectAttachmentMetasFromMessage(targetMessage = {}, candidateMessage = {}) {
  if (candidateMessage === targetMessage) return true;
  if (getMessageRole(targetMessage) !== "assistant" || getMessageRole(candidateMessage) !== "assistant") {
    return true;
  }

  // Avoid leaking the previous assistant's generated attachments into a newly
  // sent assistant turn when snapshots do not carry turnScopeId yet.
  // Tool/child messages are collected through sessionId + turnScopeId instead
  // of dialogProcessId; dialogProcessId remains backend execution metadata.
  return isSameExplicitMessageTurn(targetMessage, candidateMessage);
}
