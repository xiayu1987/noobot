/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findReusableMessageObject,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
} from "../../model/reconnectReplayModel.js";

export function applyFoldedMessagesToActiveSession(activeSession, foldedMessages = []) {
  if (!activeSession?.value) return [];
  const existingMessages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  const nextMessages = mergeCurrentUserMessagesIntoFoldedMessages({
    foldedMessages,
    existingMessages,
  }).map((nextMessage) => {
    const reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
    return reusableMessage
      ? patchMessageObjectPreservingUiState(reusableMessage, nextMessage)
      : nextMessage;
  });
  if (activeSession.value.messages !== existingMessages) {
    activeSession.value.messages = existingMessages;
  }
  existingMessages.splice(0, existingMessages.length, ...nextMessages);
  return existingMessages;
}
