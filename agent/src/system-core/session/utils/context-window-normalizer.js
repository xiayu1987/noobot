/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext,
  filterInjectedMessagesForDialog,
  isInjectedMessage,
  resolveMessageRole,
} from "../../context/session/message-context-policy.js";
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";



export const MAIN_MODEL_HISTORY_MESSAGE_LIMIT = 10;

function recentSlice(messages = [], limit = Number.POSITIVE_INFINITY) {
  const source = Array.isArray(messages) ? messages : [];
  const resolvedLimit = Number(limit);
  if (!Number.isFinite(resolvedLimit)) return source;
  if (resolvedLimit <= 0) return [];
  const keepCount = Math.floor(resolvedLimit);
  return source.length > keepCount ? source.slice(-keepCount) : source;
}

function resolveInternalMessageType(messageItem = {}) {
  return String(
    messageItem?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      messageItem?.metadata?.noobotInternalMessageType ||
      messageItem?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
}

function isActualUserMessage(messageItem = {}) {
  if (resolveMessageRole(messageItem) !== "user") return false;
  if (isInjectedMessage(messageItem)) return false;
  if (messageItem?.phaseSummaryMemory === true) return false;
  if (messageItem?.recoveredFromUnpairedTaskSummary === true) return false;
  const internalType = resolveInternalMessageType(messageItem);
  if (internalType && internalType !== "frontend_user_message") return false;
  return true;
}

function resolveHistoryDialogKey(messageItem = {}, index = 0) {
  const explicit = resolveMessageDialogProcessId(messageItem);
  if (explicit) return explicit;
  return `__missing_dialog__:${index}`;
}

export function resolveMainModelSystemMessages({
  sourceMessages = [],
  currentDialogProcessId = "",
} = {}) {
  return resolveModelContextMessages({
    sourceMessages,
    currentDialogProcessId,
    mode: "agent",
    useRecentWindow: false,
  });
}

export function resolveMainModelHistoryMessages({
  sourceMessages = [],
  historyLimit = MAIN_MODEL_HISTORY_MESSAGE_LIMIT,
} = {}) {
  const source = filterForModelContext(sourceMessages);
  const selectedByDialog = new Map();

  source.forEach((messageItem, index) => {
    const key = resolveHistoryDialogKey(messageItem, index);
    const current = selectedByDialog.get(key) || { firstUser: null, lastAssistant: null };
    if (!current.firstUser && isActualUserMessage(messageItem)) {
      current.firstUser = { message: messageItem, index };
    }
    if (resolveMessageRole(messageItem) === "assistant") {
      current.lastAssistant = { message: messageItem, index };
    }
    selectedByDialog.set(key, current);
  });

  const selected = [];
  for (const value of selectedByDialog.values()) {
    if (value.firstUser) selected.push(value.firstUser);
    if (value.lastAssistant) selected.push(value.lastAssistant);
  }

  selected.sort((left, right) => left.index - right.index);
  return recentSlice(
    selected.map((item) => item.message),
    historyLimit,
  );
}

export function resolveMainModelIncrementalMessages({
  sourceMessages = [],
  currentDialogProcessId = "",
} = {}) {
  return resolveModelContextMessages({
    sourceMessages,
    currentDialogProcessId,
    mode: "agent",
    useRecentWindow: false,
  });
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
  currentDialogProcessId = "",
  historyLimit = MAIN_MODEL_HISTORY_MESSAGE_LIMIT,
} = {}) {
  const system = resolveMainModelSystemMessages({
    sourceMessages: systemMessages,
    currentDialogProcessId,
  });
  const history = resolveMainModelHistoryMessages({
    sourceMessages: historyMessages,
    historyLimit,
  });
  const incremental = resolveMainModelIncrementalMessages({
    sourceMessages: incrementalMessages,
    currentDialogProcessId,
  });
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
  currentDialogProcessId = "",
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
  const sameDialogMessages = filterInjectedMessagesForDialog(
    sourceMessages,
    currentDialogProcessId,
  );
  const mappedMessages =
    typeof normalizeMessage === "function"
      ? sameDialogMessages
          .map((messageItem) => normalizeMessage(messageItem))
          .filter(Boolean)
      : sameDialogMessages;
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
