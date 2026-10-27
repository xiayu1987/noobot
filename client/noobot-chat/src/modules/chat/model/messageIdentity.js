/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  areCanonicalTurnScopeIdsEqual,
  requireOptionalCanonicalTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";
import { text, isObjectLike } from "@noobot/shared/value";

function trim(value = "") {
  return text(value);
}

export function getMessageSessionId(messageItem) {
  return messageItem.sessionId;
}

export function getMessageInternalType(messageItem = {}) {
  return trim(messageItem?.noobotInternalMessageType);
}

export function normalizeTurnMeta(raw = {}) {
  return {
    sessionId: getMessageSessionId(raw),
    turnScopeId: Object.hasOwn(raw, "turnScopeId")
      ? requireOptionalCanonicalTurnScopeId(raw.turnScopeId)
      : "",
    dialogProcessId: trim(raw?.dialogProcessId),
    parentDialogProcessId: trim(raw?.parentDialogProcessId),
  };
}

export function getMessageRole(messageItem = {}) {
  return trim(messageItem?.role);
}

export function getMessageDialogProcessId(messageItem = {}) {
  return trim(messageItem?.dialogProcessId);
}

export function getMessageParentDialogProcessId(messageItem = {}) {
  return trim(messageItem?.parentDialogProcessId);
}

export function getMessageTurnScopeId(messageItem = {}) {
  return trim(messageItem?.turnScopeId);
}

export function areTurnScopeIdsEquivalent(left = "", right = "") {
  return areCanonicalTurnScopeIdsEqual(left, right);
}

export function getMessageTurnScopeKey(messageItem = {}) {
  const sessionId = getMessageSessionId(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  return sessionId && turnScopeId ? `${sessionId}::${turnScopeId}` : "";
}

export function isAssistantWithoutTurnScope(messageItem = {}) {
  return getMessageRole(messageItem) === "assistant" && !getMessageTurnScopeId(messageItem);
}

export function clearTurnScopedAssets(messageItem = {}) {
  if (!isObjectLike(messageItem)) return messageItem;
  messageItem.attachments = [];
  messageItem.toolTimeline = [];
  messageItem.activityTimeline = [];
  return messageItem;
}

export function getMessageContentIdentity(messageItem) {
  if (typeof messageItem.content !== "string") {
    throw new TypeError("message_content_not_string");
  }
  return trim(messageItem.content);
}

export function isSameMessageIdentity(targetMessage = {}, candidateMessage = {}) {
  if (!targetMessage || !candidateMessage) return false;
  if (targetMessage === candidateMessage) return true;

  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  if (
    !targetTurnScopeId ||
    !areTurnScopeIdsEquivalent(getMessageTurnScopeId(candidateMessage), targetTurnScopeId)
  )
    return false;
  const targetRole = getMessageRole(targetMessage);
  const candidateRole = getMessageRole(candidateMessage);
  return Boolean(targetRole && candidateRole && targetRole === candidateRole);
}

export function findMessageIdentityIndex(targetMessage = {}, messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  return source.findIndex((message) => isSameMessageIdentity(targetMessage, message));
}

export function buildMessageAnchor(targetMessage = {}) {
  const turnScopeId = getMessageTurnScopeId(targetMessage);
  if (turnScopeId) return { turnScopeId };
  return {};
}

export function getMessageExplicitTurnIdentity(messageItem = {}) {
  return trim(getMessageTurnScopeId(messageItem));
}

export function isSameExplicitMessageTurn(leftMessage = {}, rightMessage = {}) {
  const leftIdentity = getMessageExplicitTurnIdentity(leftMessage);
  const rightIdentity = getMessageExplicitTurnIdentity(rightMessage);
  return areTurnScopeIdsEquivalent(leftIdentity, rightIdentity);
}
