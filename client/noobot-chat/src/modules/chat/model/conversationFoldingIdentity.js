/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole, getMessageTurnScopeId } from "./messageIdentity.js";
import { text } from "@noobot/shared/value";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";

function resolveMessageTurnScopeMergeKey(messageItem) {
  return getMessageTurnScopeId(messageItem);
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
  if (previousMessage === null) return false;
  const currentRole = getMessageRole(currentMessage);
  const previousRole = getMessageRole(previousMessage);
  const currentTurnScopeKey = resolveMessageTurnScopeMergeKey(currentMessage);
  const previousTurnScopeKey = resolveMessageTurnScopeMergeKey(previousMessage);
  const currentStableMessageIdentity = resolveMessageViewKey(currentMessage);
  const previousStableMessageIdentity = resolveMessageViewKey(previousMessage);
  return Boolean(
    currentRole === "assistant" &&
    previousRole === "assistant" &&
    previousMessage.workflowMessage !== true &&
    currentMessage.workflowMessage !== true &&
    currentTurnScopeKey &&
    currentTurnScopeKey === previousTurnScopeKey &&
    currentStableMessageIdentity === previousStableMessageIdentity &&
    !(previousMessage.chatPresentation === true && currentMessage.chatPresentation === true),
  );
}

export {
  buildModelRunLabel,
  canMergeIntoPreviousAssistantMessage,
  normalizeFoldedPresentationMessage,
  resolveMessageTurnScopeMergeKey,
};
