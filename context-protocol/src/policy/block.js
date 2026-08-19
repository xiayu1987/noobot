/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  getMessageToolCalls,
  resolveMessageDialogProcessId,
  resolveMessageRole,
  resolveToolCallId,
  readMessageField,
} from "./message.js";
import { isCheckpointBoundaryToolMessage } from "./summary.js";
import { resolveModelFinalMessages } from "./window.js";
import {
  extractContextTaskSummary,
  recoverContextTaskSummaryToolResult,
} from "../task/summary-context.js";

function text(value) {
  return String(value || "").trim();
}

function messageTurnScopeId(message = {}) {
  return readMessageField(message, "turnScopeId");
}

export function extractTaskSummaryText(message = {}) {
  return extractContextTaskSummary(message);
}

export function createHistoryRoundIdentityResolver(messages = []) {
  let activeDialogProcessId = "";
  const identityByMessage = new WeakMap();
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== "object") continue;
    const explicitDialogProcessId = resolveMessageDialogProcessId(message);
    if (explicitDialogProcessId) activeDialogProcessId = explicitDialogProcessId;
    identityByMessage.set(message, explicitDialogProcessId || activeDialogProcessId);
  }
  return (message) => identityByMessage.get(message) || resolveMessageDialogProcessId(message);
}

export function normalizeUnpairedTaskSummaryToolResults(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const knownToolCallIds = new Set();
  for (const message of source) {
    if (resolveMessageRole(message) !== "assistant") continue;
    getMessageToolCalls(message)
      .map(resolveToolCallId)
      .filter(Boolean)
      .forEach((id) => knownToolCallIds.add(id));
  }
  return source.map((message) => {
    if (resolveMessageRole(message) !== "tool" || !isCheckpointBoundaryToolMessage(message))
      return message;
    const toolCallId = resolveToolCallId(message);
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
    if (resolveMessageRole(message) !== "user") continue;
    const messageTurn = messageTurnScopeId(message);
    const messageDialog = resolveMessageDialogProcessId(message);
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
        resolveMessageDialogProcessId(message) &&
        blockedDialogs.has(resolveMessageDialogProcessId(message))
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
  const current =
    currentUserMessage && typeof currentUserMessage === "object" ? currentUserMessage : null;
  const content = text(current?.content);
  const currentMessageId = text(
    current?.messageUid || current?.noobotMessageId || current?.additional_kwargs?.noobotMessageId,
  );
  if (current && (!content || !currentMessageId)) {
    throw new Error("currentUserMessage requires persisted content and messageUid");
  }
  const identity = {
    dialogProcessId: resolveMessageDialogProcessId(current || {}),
    turnScopeId: messageTurnScopeId(current || {}),
  };
  if (
    current &&
    (resolveMessageRole(current) !== "user" || !identity.dialogProcessId || !identity.turnScopeId)
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
      resolveMessageRole(message) === "user" &&
      text(
        message?.messageUid ||
          message?.noobotMessageId ||
          message?.additional_kwargs?.noobotMessageId,
      ) === currentMessageId,
  );
  if (content && !currentExists) {
    incremental.push({ ...current });
  }
  return resolveModelFinalMessages({
    systemMessages,
    historyMessages: history,
    incrementalMessages: incremental,
    historyLimit,
    policyOptions,
    resolveHistoryDialogProcessId: createHistoryRoundIdentityResolver(history),
  });
}
