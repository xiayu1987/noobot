/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  readContextMessageField,
  resolveContextMessageDialogProcessId,
  resolveContextMessageKey,
  resolveContextMessageRole,
} from "../message/codec.js";
import { projectSessionRecordToContextMessage } from "../message/session-projection.js";
import { resolveModelFinalMessages } from "./window.js";

function messageTurnScopeId(message = {}) {
  return readContextMessageField(message, "turnScopeId");
}

function filterCurrentTurnMessagesFromHistory(source, { turnScopeId, dialogProcessId }) {
  const blockedTurns = new Set();
  const blockedDialogs = new Set();
  for (const message of source) {
    if (resolveContextMessageRole(message) !== "user") continue;
    const messageTurn = messageTurnScopeId(message);
    const messageDialog = resolveContextMessageDialogProcessId(message);
    if (messageTurn !== turnScopeId && messageDialog !== dialogProcessId) continue;
    if (messageTurn) blockedTurns.add(messageTurn);
    if (messageDialog) blockedDialogs.add(messageDialog);
  }
  if (!blockedTurns.size && !blockedDialogs.size) return source;
  return source.filter(
    (message) =>
      !(messageTurnScopeId(message) && blockedTurns.has(messageTurnScopeId(message))) &&
      !(
        resolveContextMessageDialogProcessId(message) &&
        blockedDialogs.has(resolveContextMessageDialogProcessId(message))
      ),
  );
}

export function buildCanonicalMessageBlocks({
  systemMessages,
  historyMessages,
  incrementalMessages,
  currentUserMessage,
  historyLimit,
}) {
  if (
    !currentUserMessage ||
    typeof currentUserMessage !== "object" ||
    Array.isArray(currentUserMessage)
  ) {
    throw new TypeError("currentUserMessage must be a canonical persisted message entity");
  }

  const current = projectSessionRecordToContextMessage(currentUserMessage);
  const content = current.content;
  const currentMessageId = resolveContextMessageKey(current);
  if (typeof content !== "string" || !content) {
    throw new Error("currentUserMessage requires persisted content");
  }
  const identity = {
    dialogProcessId: resolveContextMessageDialogProcessId(current),
    turnScopeId: messageTurnScopeId(current),
  };
  if (
    resolveContextMessageRole(current) !== "user" ||
    !identity.dialogProcessId ||
    !identity.turnScopeId
  ) {
    throw new Error("currentUserMessage requires canonical user round identity");
  }
  const history = filterCurrentTurnMessagesFromHistory(historyMessages, identity);
  const incremental = [...incrementalMessages];
  const currentExists = incremental.some(
    (message) =>
      resolveContextMessageRole(message) === "user" &&
      resolveContextMessageKey(message) === currentMessageId,
  );
  if (!currentExists) {
    incremental.push(current);
  }
  return resolveModelFinalMessages({
    systemMessages,
    historyMessages: history,
    incrementalMessages: incremental,
    historyLimit,
  });
}
