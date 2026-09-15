/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole, getMessageTurnScopeId } from "./messageIdentity.js";

function resolveStableMessageIdentity(messageItem = {}) {
  const presentationMessageId = String(messageItem?.presentationMessageId || "").trim();
  if (getMessageRole(messageItem) === "assistant" && presentationMessageId) {
    return presentationMessageId;
  }
  return String(messageItem?.messageId || messageItem?.id || "").trim();
}

function resolveMessageTurnScopeMergeKey(messageItem = {}) {
  const turnScopeId = getMessageTurnScopeId(messageItem);
  if (!turnScopeId) return "";
  const sessionId = String(messageItem?.sessionId || messageItem?.session_id || "").trim();
  return sessionId ? `${sessionId}::${turnScopeId}` : turnScopeId;
}

function buildModelRunLabel(messageItem = {}) {
  const modelAlias = String(messageItem?.modelAlias || "").trim();
  const modelName = String(messageItem?.modelName || messageItem?.model || "").trim();
  if (modelAlias && modelName) return `${modelAlias} (${modelName})`;
  return modelAlias || modelName || "";
}

function resolveFoldedPresentationMessageId(sourceMessage, projectedMessage) {
  return String(
    projectedMessage?.presentationMessageId || sourceMessage?.presentationMessageId || "",
  ).trim();
}

function resolveFoldedSourceMessageId(sourceMessage, projectedMessage) {
  return String(
    projectedMessage?.sourceMessageId ||
      sourceMessage?.sourceMessageId ||
      sourceMessage?.messageId ||
      sourceMessage?.id ||
      "",
  ).trim();
}

function normalizeFoldedPresentationMessage(sourceMessage = {}, projectedMessage = {}) {
  const messageRole = getMessageRole(projectedMessage) || getMessageRole(sourceMessage);
  const presentationMessageId = resolveFoldedPresentationMessageId(sourceMessage, projectedMessage);
  const sourceMessageId = resolveFoldedSourceMessageId(sourceMessage, projectedMessage);
  const normalizedMessage = { ...projectedMessage };

  if (messageRole === "assistant" && presentationMessageId) {
    normalizedMessage.id = presentationMessageId;
    normalizedMessage.messageId = presentationMessageId;
    normalizedMessage.presentationMessageId = presentationMessageId;
    if (sourceMessageId && sourceMessageId !== presentationMessageId) {
      normalizedMessage.sourceMessageId = sourceMessageId;
    }
  }

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
  const currentStableMessageIdentity = resolveStableMessageIdentity(currentMessage);
  const previousStableMessageIdentity = resolveStableMessageIdentity(previousMessage);
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
  resolveStableMessageIdentity,
};
