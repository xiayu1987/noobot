/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function trim(value = "") {
  return String(value || "").trim();
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
    turnScopeId: trim(owner?.turnScopeId || owner?.turn_scope_id),
    dialogProcessId: trim(owner?.dialogProcessId || owner?.dialog_process_id || raw?.ownerDialogProcessId),
    role: trim(owner?.role),
  };
}

export function normalizeTurnMeta(raw = {}) {
  const owner = normalizeTurnOwner(raw);
  const normalized = {
    sessionId: getMessageSessionId(raw),
    turnScopeId: trim(raw?.turnScopeId || raw?.turn_scope_id),
    turnId: trim(raw?.turnId || raw?.turn_id),
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

export function getMessageTurnId(messageItem = {}) {
  return normalizeTurnMeta(messageItem).turnId;
}

export function getMessageStableId(messageItem = {}) {
  return trim(messageItem?.messageId || messageItem?.message_id || messageItem?.id);
}

export function getMessageExplicitTurnIdentity(messageItem = {}) {
  return trim(
    getMessageTurnScopeId(messageItem) ||
      getMessageTurnId(messageItem) ||
      getMessageStableId(messageItem),
  );
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
  if (targetTurnScopeId) {
    return false;
  }

  const targetDialogProcessId = getMessageDialogProcessId(targetMessage);
  const candidateDialogProcessId = getMessageDialogProcessId(candidateMessage);
  if (targetDialogProcessId && candidateDialogProcessId) {
    return targetDialogProcessId === candidateDialogProcessId;
  }
  return true;
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
  // sent assistant turn when snapshots do not carry turnScopeId/turnId yet.
  // Tool/child messages are still collected through dialogProcess relation.
  return isSameExplicitMessageTurn(targetMessage, candidateMessage);
}
