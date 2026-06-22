/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function trim(value = "") {
  return String(value || "").trim();
}

export function getMessageRole(messageItem = {}) {
  return trim(messageItem?.role);
}

export function getMessageDialogProcessId(messageItem = {}) {
  return trim(messageItem?.dialogProcessId || messageItem?.dialogId);
}

export function getMessageParentDialogProcessId(messageItem = {}) {
  return trim(messageItem?.parentDialogProcessId || messageItem?.parentDialogId);
}

export function getMessageClientTurnId(messageItem = {}) {
  return trim(messageItem?.clientTurnId || messageItem?.turnScopeId || messageItem?.client_turn_id);
}

export function getMessageTurnId(messageItem = {}) {
  return trim(messageItem?.turnId || messageItem?.turn_id);
}

export function getMessageStableId(messageItem = {}) {
  return trim(messageItem?.messageId || messageItem?.message_id || messageItem?.id);
}

export function getMessageExplicitTurnIdentity(messageItem = {}) {
  return trim(
    getMessageClientTurnId(messageItem) ||
      getMessageTurnId(messageItem) ||
      getMessageStableId(messageItem),
  );
}

export function isSameMessageRound(targetMessage = {}, candidateMessage = {}) {
  const targetClientTurnId = getMessageClientTurnId(targetMessage);
  const candidateClientTurnId = getMessageClientTurnId(candidateMessage);
  if (targetClientTurnId && candidateClientTurnId) {
    return targetClientTurnId === candidateClientTurnId;
  }
  if (targetClientTurnId) {
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
  // sent assistant turn when snapshots do not carry clientTurnId/turnId yet.
  // Tool/child messages are still collected through dialogProcess relation.
  return isSameExplicitMessageTurn(targetMessage, candidateMessage);
}
