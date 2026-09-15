/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole } from "./messageIdentity.js";
import { normalizeArray } from "./messageAttachmentsProjection.js";
import { isPluginInjectedMessage } from "./messageVisibility.js";
import {
  buildModelRunLabel,
  canMergeIntoPreviousAssistantMessage,
  normalizeFoldedPresentationMessage,
} from "./conversationFoldingIdentity.js";
import {
  applyTurnArtifacts,
  collectTurnArtifacts,
  mergeFoldedAssistantMessage,
} from "./conversationFoldingMerge.js";

function isFoldableConversationMessage(messageItem) {
  if (isPluginInjectedMessage(messageItem)) return false;
  const role = getMessageRole(messageItem);
  if (role !== "assistant" && messageItem?.chatPresentation === false) return false;
  return role === "assistant" || role === "user";
}

function applyModelRunLabel(messageItem) {
  const modelRunLabel = buildModelRunLabel(messageItem);
  if (!modelRunLabel) return;
  const modelRuns = normalizeArray(messageItem.modelRuns);
  if (!modelRuns.includes(modelRunLabel)) {
    messageItem.modelRuns = [...modelRuns, modelRunLabel];
  }
}

function mergeFoldedMessages(foldedMessages = []) {
  const mergedMessages = [];
  for (const currentMessage of foldedMessages) {
    applyModelRunLabel(currentMessage);
    const previousMessage = mergedMessages[mergedMessages.length - 1] || null;
    if (!canMergeIntoPreviousAssistantMessage(previousMessage, currentMessage)) {
      mergedMessages.push(currentMessage);
      continue;
    }
    mergeFoldedAssistantMessage(previousMessage, currentMessage);
  }
  return mergedMessages;
}

function foldConversationMessages(messages = [], buildView) {
  const sourceMessages = normalizeArray(messages);
  const foldedMessages = sourceMessages
    .filter((messageItem) => isFoldableConversationMessage(messageItem))
    .map((messageItem) => normalizeFoldedPresentationMessage(messageItem, buildView(messageItem)));
  const mergedMessages = mergeFoldedMessages(foldedMessages);
  applyTurnArtifacts(mergedMessages, collectTurnArtifacts(sourceMessages));
  return mergedMessages.filter((message) => message?.chatPresentation !== false);
}

export { foldConversationMessages };
