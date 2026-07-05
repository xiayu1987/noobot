/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext,
  isMessageSummarized,
  isSystemLikeMessageRole,
  resolveMessageRole,
} from "../../context/session/message-context-policy.js";
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";



export const MAIN_MODEL_HISTORY_ROUND_LIMIT =
  TURN_THRESHOLDS.session.mainModelHistoryRoundLimit;

function readMessageField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key || !message || typeof message !== "object") return "";
  return String(
    message?.[key] ??
      message?.additional_kwargs?.[key] ??
      message?.lc_kwargs?.[key] ??
      message?.lc_kwargs?.additional_kwargs?.[key] ??
      "",
  ).trim();
}

function resolveMessageContentText(message = {}) {
  const content = message?.content ?? message?.lc_kwargs?.content ?? "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
}

function resolveMessageToolCallId(message = {}) {
  return String(
    message?.tool_call_id ??
      message?.toolCallId ??
      message?.lc_kwargs?.tool_call_id ??
      message?.lc_kwargs?.toolCallId ??
      "",
  ).trim();
}

function resolveAssistantToolCallIds(message = {}) {
  const calls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.lc_kwargs?.tool_calls)
      ? message.lc_kwargs.tool_calls
      : Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : [];
  return calls
    .map((call = {}) => String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim())
    .filter(Boolean)
    .join(",");
}

function resolveMessageIdentityKey(message = {}) {
  const explicitId =
    readMessageField(message, "noobotMessageId") ||
    readMessageField(message, "messageId") ||
    readMessageField(message, "id");
  if (explicitId) return `id:${explicitId}`;
  return [
    resolveMessageRole(message),
    resolveMessageToolCallId(message),
    resolveAssistantToolCallIds(message),
    readMessageField(message, "injectedMessageType") || readMessageField(message, "injected_message_type"),
    resolveMessageDialogProcessId(message),
    readMessageField(message, "turnScopeId"),
    resolveMessageContentText(message),
  ].join("|||");
}

function buildIdentitySet(messages = []) {
  return new Set(
    (Array.isArray(messages) ? messages : [])
      .map((message) => resolveMessageIdentityKey(message))
      .filter(Boolean),
  );
}

function filterMessagesNotInIdentitySet(messages = [], blockedKeys = new Set()) {
  if (!(blockedKeys instanceof Set) || !blockedKeys.size) return messages;
  return (Array.isArray(messages) ? messages : []).filter((message) => {
    const key = resolveMessageIdentityKey(message);
    return !key || !blockedKeys.has(key);
  });
}

function recentSlice(messages = [], limit = Number.POSITIVE_INFINITY) {
  const source = Array.isArray(messages) ? messages : [];
  const resolvedLimit = Number(limit);
  if (!Number.isFinite(resolvedLimit)) return source;
  if (resolvedLimit <= 0) return [];
  const keepCount = Math.floor(resolvedLimit);
  return source.length > keepCount ? source.slice(-keepCount) : source;
}

function appendDialogGroupMessage(groupsByDialog, key, messageItem, index) {
  const current = groupsByDialog.get(key) || {
    startIndex: index,
    messages: [],
  };
  current.messages.push({ message: messageItem, index });
  groupsByDialog.set(key, current);
}

function isSystemLikeMessage(messageItem = {}) {
  return isSystemLikeMessageRole(resolveMessageRole(messageItem));
}

function shouldKeepHistoryMessage(messageItem = {}) {
  if (isSystemLikeMessage(messageItem)) return false;
  if (isMessageSummarized(messageItem)) return false;
  return true;
}

export function resolveMainModelSystemMessages({
  sourceMessages = [],
} = {}) {
  return filterForModelContext(sourceMessages, { keepLatestInjectedOnly: true });
}

export function resolveMainModelHistoryMessages({
  sourceMessages = [],
  historyLimit = MAIN_MODEL_HISTORY_ROUND_LIMIT,
} = {}) {
  const source = Array.isArray(sourceMessages) ? sourceMessages : [];
  const groupsByDialog = new Map();

  source.forEach((messageItem, index) => {
    const explicitKey = resolveMessageDialogProcessId(messageItem);
    if (explicitKey) {
      appendDialogGroupMessage(groupsByDialog, explicitKey, messageItem, index);
    }
  });

  const rounds = [];
  for (const value of groupsByDialog.values()) {
    if (value.startIndex < 0) continue;
    rounds.push({
      startIndex: value.startIndex,
      endIndex: Number.POSITIVE_INFINITY,
      messages: value.messages,
    });
  }

  rounds.sort((left, right) => left.startIndex - right.startIndex);
  const selectedRounds = recentSlice(rounds, historyLimit);
  return selectedRounds.flatMap((round) =>
    round.messages
      .filter(({ index }) => index >= round.startIndex && index <= round.endIndex)
      .map(({ message }) => message)
      .filter((messageItem) => shouldKeepHistoryMessage(messageItem)),
  );
}

export function resolveMainModelIncrementalMessages({
  sourceMessages = [],
} = {}) {
  return filterForModelContext(sourceMessages, { keepLatestInjectedOnly: true });
}

export function resolveMainModelConversationMessages({
  historyMessages = [],
  incrementalMessages = [],
} = {}) {
  return [
    ...resolveMainModelHistoryMessages({ sourceMessages: historyMessages }),
    ...resolveMainModelIncrementalMessages({ sourceMessages: incrementalMessages }),
  ];
}

export function resolveMainModelFinalMessages({
  systemMessages = [],
  historyMessages = [],
  incrementalMessages = [],
  historyLimit = MAIN_MODEL_HISTORY_ROUND_LIMIT,
} = {}) {
  const system = resolveMainModelSystemMessages({
    sourceMessages: systemMessages,
  });
  const systemKeys = buildIdentitySet(system);
  const incremental = filterMessagesNotInIdentitySet(
    resolveMainModelIncrementalMessages({
      sourceMessages: incrementalMessages,
    }),
    systemKeys,
  );
  const blockedHistoryKeys = new Set([
    ...systemKeys,
    ...buildIdentitySet(incremental),
  ]);
  const history = filterMessagesNotInIdentitySet(
    resolveMainModelHistoryMessages({
      sourceMessages: historyMessages,
      historyLimit,
    }),
    blockedHistoryKeys,
  );
  return {
    system,
    history,
    incremental,
    messages: [...system, ...history, ...incremental],
  };
}

export function filterSummarizedMessages(messages = []) {
  return filterForModelContext(messages);
}
