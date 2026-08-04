/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  filterForModelContext,
  isMessageSummarized,
  isSystemLikeMessageRole,
  resolveMessageDialogProcessId,
  resolveMessageId,
  resolveMessageRole,
} from "./message-policy.js";

function recentSlice(values = [], limit = Number.POSITIVE_INFINITY) {
  const source = Array.isArray(values) ? values : [];
  const count = Number(limit);
  if (!Number.isFinite(count)) return source;
  if (count <= 0) return [];
  return source.length > Math.floor(count) ? source.slice(-Math.floor(count)) : source;
}

function messageIdentity(message = {}) {
  const explicitId = resolveMessageId(message);
  return explicitId ? `id:${explicitId}` : "";
}

function removeBlocked(messages, blocked) {
  if (!(blocked instanceof Set) || !blocked.size) return messages;
  return (Array.isArray(messages) ? messages : []).filter((message) => !blocked.has(messageIdentity(message)));
}

function identities(messages) {
  return new Set((Array.isArray(messages) ? messages : []).map(messageIdentity).filter(Boolean));
}

export function resolveModelSystemMessages({ sourceMessages = [], policyOptions = {} } = {}) {
  return filterForModelContext(sourceMessages, policyOptions);
}

export function resolveModelHistoryMessages({
  sourceMessages = [],
  historyLimit = Number.POSITIVE_INFINITY,
  resolveHistoryDialogProcessId = resolveMessageDialogProcessId,
} = {}) {
  const resolveDialog = typeof resolveHistoryDialogProcessId === "function"
    ? resolveHistoryDialogProcessId
    : resolveMessageDialogProcessId;
  const source = (Array.isArray(sourceMessages) ? sourceMessages : []).filter((message) => {
    if (!resolveDialog(message)) return false;
    if (isSystemLikeMessageRole(resolveMessageRole(message))) return false;
    return !isMessageSummarized(message);
  });
  const groups = new Map();
  source.forEach((message, index) => {
    const key = resolveDialog(message);
    const group = groups.get(key) || { key, startIndex: index, messages: [] };
    group.messages.push(message);
    groups.set(key, group);
  });
  return recentSlice([...groups.values()], historyLimit).flatMap((round) => round.messages);
}

export function resolveModelIncrementalMessages({ sourceMessages = [], policyOptions = {} } = {}) {
  return filterForModelContext(sourceMessages, policyOptions);
}

export function resolveModelFinalMessages({
  systemMessages = [],
  historyMessages = [],
  incrementalMessages = [],
  historyLimit = Number.POSITIVE_INFINITY,
  policyOptions = {},
  resolveHistoryDialogProcessId = resolveMessageDialogProcessId,
} = {}) {
  const system = resolveModelSystemMessages({ sourceMessages: systemMessages, policyOptions });
  const systemIdentities = identities(system);
  const incremental = removeBlocked(
    resolveModelIncrementalMessages({ sourceMessages: incrementalMessages, policyOptions }),
    systemIdentities,
  );
  const historyByStableIdentity = removeBlocked(resolveModelHistoryMessages({
    sourceMessages: historyMessages,
    historyLimit,
    resolveHistoryDialogProcessId,
  }), new Set([...systemIdentities, ...identities(incremental)]));
  const history = historyByStableIdentity;
  return { system, history, incremental, messages: [...system, ...history, ...incremental] };
}

export function materializeModelContext(context = {}) {
  if (Number(context?.protocolVersion) !== 1) {
    throw new Error("materializeModelContext requires modelContext protocolVersion=1");
  }
  const blocks = context?.messageBlocks && typeof context.messageBlocks === "object"
    ? context.messageBlocks
    : {};
  return resolveModelFinalMessages({
    systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
    historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
    incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  });
}
