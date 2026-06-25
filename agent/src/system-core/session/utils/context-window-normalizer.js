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



export const MAIN_MODEL_HISTORY_ROUND_LIMIT = 3;

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

export function normalizeContextWindow({
  sourceMessages = [],
  startIndex = 0,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  const source = filterSummarizedMessages(sourceMessages);
  const normalizedStartIndex = Math.max(0, Number(startIndex) || 0);
  const resolvedLimit = Number(limit);
  const useFiniteLimit = Number.isFinite(resolvedLimit);
  if (useFiniteLimit && resolvedLimit <= 0) return [];
  if (!source.length) return [];

  let windowStartIndex = normalizedStartIndex;
  let windowMessages = source.slice(normalizedStartIndex);
  if (!windowMessages.length) return [];

  if (useFiniteLimit && windowMessages.length > Math.floor(resolvedLimit)) {
    const keepCount = Math.floor(resolvedLimit);
    windowMessages = windowMessages.slice(-keepCount);
    windowStartIndex = Math.max(0, source.length - keepCount);
  }

  let prependedUserAnchor = false;
  const firstRole = String(windowMessages[0]?.role || "").trim().toLowerCase();
  const shouldAnchorByFirstAssistant = firstRole === "assistant";
  const hasUserMessage = windowMessages.some(
    (messageItem) => String(messageItem?.role || "").trim().toLowerCase() === "user",
  );
  if ((shouldAnchorByFirstAssistant || !hasUserMessage) && windowStartIndex > 0) {
    for (let index = windowStartIndex - 1; index >= 0; index -= 1) {
      const messageItem = source[index];
      if (String(messageItem?.role || "").trim().toLowerCase() !== "user") continue;
      windowMessages = [messageItem, ...windowMessages];
      prependedUserAnchor = true;
      break;
    }
  }

  if (useFiniteLimit && windowMessages.length > Math.floor(resolvedLimit)) {
    while (windowMessages.length > Math.floor(resolvedLimit)) {
      if (prependedUserAnchor && windowMessages.length > 1) {
        windowMessages.splice(1, 1);
      } else {
        windowMessages.shift();
      }
    }
  }

  return filterSummarizedMessages(windowMessages);
}

export function normalizeRecentWindow(messages = [], limit = 20) {
  const source = filterSummarizedMessages(messages);
  const resolvedLimit = Number(limit);
  if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) return [];
  const startIndex = Math.max(0, source.length - Math.floor(resolvedLimit));
  return normalizeContextWindow({
    sourceMessages: source,
    startIndex,
    limit: resolvedLimit,
  });
}

export function resolveModelContextMessages({
  sourceMessages = [],
  mode = "agent",
  normalizeMessage = null,
  shouldKeepMessage = null,
  useRecentWindow = false,
  recentLimit = 20,
  startIndex = 0,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  const normalizedMode = String(mode || "agent").trim().toLowerCase();
  const useRecentWindowByMode =
    normalizedMode === "plugin" ? true : useRecentWindow === true;
  const source = filterForModelContext(sourceMessages, { keepLatestInjectedOnly: true });
  const mappedMessages =
    typeof normalizeMessage === "function"
      ? source
          .map((messageItem) => normalizeMessage(messageItem))
          .filter(Boolean)
      : source;
  const filteredMessages =
    typeof shouldKeepMessage === "function"
      ? mappedMessages.filter((messageItem) => shouldKeepMessage(messageItem))
      : mappedMessages;
  if (useRecentWindowByMode) {
    return normalizeRecentWindow(filteredMessages, recentLimit);
  }
  return normalizeContextWindow({
    sourceMessages: filteredMessages,
    startIndex,
    limit,
  });
}
