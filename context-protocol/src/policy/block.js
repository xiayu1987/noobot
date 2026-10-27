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
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "../message/codec.js";
import { projectSessionRecordToContextMessage } from "../message/session-projection.js";
import { isCheckpointBoundaryToolMessage } from "./summary.js";
import { resolveModelFinalMessages } from "./window.js";
import {
  extractContextTaskSummary,
  recoverContextTaskSummaryToolResult,
} from "../task/summary-context.js";

function messageTurnScopeId(message = {}) {
  return readContextMessageField(message, "turnScopeId");
}

export function extractTaskSummaryText(message = {}) {
  return extractContextTaskSummary(message);
}

export function normalizeUnpairedTaskSummaryToolResults(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const knownToolCallIds = new Set();
  for (const message of source) {
    if (resolveContextMessageRole(message) !== "assistant") continue;
    resolveContextToolCalls(message)
      .map(resolveContextToolCallDeclarationId)
      .filter(Boolean)
      .forEach((id) => knownToolCallIds.add(id));
  }
  return source.map((message) => {
    if (resolveContextMessageRole(message) !== "tool" || !isCheckpointBoundaryToolMessage(message))
      return message;
    const toolCallId = resolveContextToolResultCallId(message);
    if (toolCallId && knownToolCallIds.has(toolCallId)) return message;
    return recoverContextTaskSummaryToolResult(message) || message;
  });
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
  policyOptions = {},
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
  const normalizedHistory = normalizeUnpairedTaskSummaryToolResults(historyMessages);
  const history = filterCurrentTurnMessagesFromHistory(normalizedHistory, identity);
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
    policyOptions,
  });
}
