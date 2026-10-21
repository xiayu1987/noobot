/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  readContextMessageField,
  resolveContextMessageDialogProcessId,
  resolveContextMessageId,
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
import { text } from "@noobot/shared/value";

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

export function filterCurrentTurnMessagesFromHistory(
  messages = [],
  { currentTurnScopeId = "", currentDialogProcessId = "" } = {},
) {
  const turnScopeId = text(currentTurnScopeId);
  const dialogProcessId = text(currentDialogProcessId);
  const source = Array.isArray(messages) ? messages : [];
  if (!turnScopeId && !dialogProcessId) return source;
  const blockedTurns = new Set();
  const blockedDialogs = new Set();
  for (const message of source) {
    if (resolveContextMessageRole(message) !== "user") continue;
    const messageTurn = messageTurnScopeId(message);
    const messageDialog = resolveContextMessageDialogProcessId(message);
    if (
      !(turnScopeId && messageTurn === turnScopeId) &&
      !(dialogProcessId && messageDialog === dialogProcessId)
    )
      continue;
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
  systemMessages = [],
  historyMessages = [],
  incrementalMessages = [],
  currentUserMessage = null,
  historyExclusionIdentity = null,
  historyLimit = Number.POSITIVE_INFINITY,
  policyOptions = {},
} = {}) {
  if (
    currentUserMessage !== null &&
    (typeof currentUserMessage !== "object" || Array.isArray(currentUserMessage))
  ) {
    throw new TypeError("currentUserMessage must be a canonical persisted message entity");
  }

  const current = currentUserMessage
    ? projectSessionRecordToContextMessage(currentUserMessage)
    : null;
  const content = text(current?.content);
  const currentMessageId = current ? resolveContextMessageId(current) : "";
  if (current && !content) {
    throw new Error("currentUserMessage requires persisted content");
  }
  const identity = {
    dialogProcessId: resolveContextMessageDialogProcessId(current || {}),
    turnScopeId: messageTurnScopeId(current || {}),
  };
  if (
    current &&
    (resolveContextMessageRole(current) !== "user" ||
      !identity.dialogProcessId ||
      !identity.turnScopeId)
  ) {
    throw new Error("currentUserMessage requires canonical user round identity");
  }
  const exclusionIdentity =
    historyExclusionIdentity && typeof historyExclusionIdentity === "object"
      ? historyExclusionIdentity
      : identity;
  const normalizedHistory = normalizeUnpairedTaskSummaryToolResults(historyMessages);
  const history = content
    ? filterCurrentTurnMessagesFromHistory(normalizedHistory, {
        currentTurnScopeId: text(exclusionIdentity?.turnScopeId),
        currentDialogProcessId: text(exclusionIdentity?.dialogProcessId),
      })
    : normalizedHistory;
  const incremental = [...(Array.isArray(incrementalMessages) ? incrementalMessages : [])];
  const currentExists = incremental.some(
    (message) =>
      resolveContextMessageRole(message) === "user" &&
      resolveContextMessageId(message) === currentMessageId,
  );
  if (content && !currentExists) {
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
