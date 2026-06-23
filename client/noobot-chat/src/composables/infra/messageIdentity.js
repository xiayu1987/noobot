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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
  return trim(messageItem?.role);
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

export function getMessageStableId(messageItem = {}) {
  return trim(messageItem?.id);
}

export function getMessageContentIdentity(messageItem = {}) {
  return trim(messageItem?.content);
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
  const targetRole = lower(getMessageRole(targetMessage));
  if (targetDialogProcessId) {
    return (
      getMessageDialogProcessId(candidateMessage) === targetDialogProcessId &&
      (!targetRole || lower(getMessageRole(candidateMessage)) === targetRole)
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
