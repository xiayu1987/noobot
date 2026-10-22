/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole, getMessageTurnScopeId } from "./messageIdentity.js";
import { text } from "@noobot/shared/value";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";

function resolveMessageTurnScopeMergeKey(messageItem = {}) {
  const turnScopeId = getMessageTurnScopeId(messageItem);
  if (!turnScopeId) return "";
  const sessionId = text(messageItem?.sessionId);
  return sessionId ? `${sessionId}::${turnScopeId}` : turnScopeId;
}

function buildModelRunLabel(messageItem = {}) {
  const modelAlias = text(messageItem?.modelAlias);
  const modelName = text(messageItem?.modelName);
  if (modelAlias && modelName) return `${modelAlias} (${modelName})`;
  return modelAlias || modelName || "";
}

function normalizeFoldedPresentationMessage(sourceMessage = {}, projectedMessage = {}) {
  const normalizedMessage = { ...projectedMessage };
  if (sourceMessage?.chatPresentation === false) {
    normalizedMessage.content = "";
  }
  return normalizedMessage;
}

function canMergeIntoPreviousAssistantMessage(previousMessage, currentMessage) {
  const currentRole = getMessageRole(currentMessage);
  const previousRole = getMessageRole(previousMessage);
  const currentTurnScopeKey = resolveMessageTurnScopeMergeKey(currentMessage);
  const previousTurnScopeKey = resolveMessageTurnScopeMergeKey(previousMessage);
  const currentStableMessageIdentity = resolveMessageViewKey(currentMessage);
  const previousStableMessageIdentity = resolveMessageViewKey(previousMessage);
  const hasDifferentStableMessageIdentity =
    currentStableMessageIdentity &&
    previousStableMessageIdentity &&
    currentStableMessageIdentity !== previousStableMessageIdentity;
  const hasUnpairedStableMessageIdentity =
    Boolean(currentStableMessageIdentity || previousStableMessageIdentity) &&
    currentStableMessageIdentity !== previousStableMessageIdentity;
  return Boolean(
    previousMessage &&
    currentRole === "assistant" &&
    previousRole === "assistant" &&
    previousMessage?.workflowMessage !== true &&
    currentMessage?.workflowMessage !== true &&
    currentTurnScopeKey &&
    previousTurnScopeKey &&
    currentTurnScopeKey === previousTurnScopeKey &&
    !hasDifferentStableMessageIdentity &&
    !hasUnpairedStableMessageIdentity &&
    !(previousMessage?.chatPresentation === true && currentMessage?.chatPresentation === true),
  );
}

export {
  buildModelRunLabel,
  canMergeIntoPreviousAssistantMessage,
  normalizeFoldedPresentationMessage,
  resolveMessageTurnScopeMergeKey,
};
