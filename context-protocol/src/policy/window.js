/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  isContextSystemMessage,
  resolveContextMessageDialogProcessId,
  resolveContextMessageKey,
  resolveContextMessageSummarized,
} from "../message/codec.js";
import { filterForModelContext } from "./message.js";

function recentSlice(values = [], limit = Number.POSITIVE_INFINITY) {
  const source = Array.isArray(values) ? values : [];
  const count = Number(limit);
  if (!Number.isFinite(count)) return source;
  if (count <= 0) return [];
  return source.length > Math.floor(count) ? source.slice(-Math.floor(count)) : source;
}

function messageIdentity(message = {}) {
  return `id:${resolveContextMessageKey(message)}`;
}

function removeBlocked(messages, blocked) {
  if (!(blocked instanceof Set) || !blocked.size) return messages;
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => !blocked.has(messageIdentity(message)),
  );
}

function identities(messages) {
  return new Set((Array.isArray(messages) ? messages : []).map(messageIdentity).filter(Boolean));
}

function resolveModelBlockMessages({ sourceMessages = [], policyOptions = {} } = {}) {
  return filterForModelContext(sourceMessages, policyOptions);
}

export function resolveModelSystemMessages(options = {}) {
  return resolveModelBlockMessages(options);
}

export function resolveModelHistoryMessages({
  sourceMessages = [],
  historyLimit = Number.POSITIVE_INFINITY,
} = {}) {
  const source = (Array.isArray(sourceMessages) ? sourceMessages : []).filter((message) => {
    if (isContextSystemMessage(message)) return false;

    if (!resolveContextMessageDialogProcessId(message)) {
      throw new Error("history context message requires additional_kwargs.dialogProcessId");
    }
    return !resolveContextMessageSummarized(message);
  });
  const groups = new Map();
  source.forEach((message, index) => {
    const key = resolveContextMessageDialogProcessId(message);
    const group = groups.get(key) || { key, startIndex: index, messages: [] };
    group.messages.push(message);
    groups.set(key, group);
  });
  return recentSlice([...groups.values()], historyLimit).flatMap((round) => round.messages);
}

export function resolveModelIncrementalMessages(options = {}) {
  return resolveModelBlockMessages(options);
}

export function resolveModelFinalMessages({
  systemMessages = [],
  historyMessages = [],
  incrementalMessages = [],
  historyLimit = Number.POSITIVE_INFINITY,
  policyOptions = {},
} = {}) {
  const system = resolveModelSystemMessages({ sourceMessages: systemMessages, policyOptions });
  const systemIdentities = identities(system);
  const incremental = removeBlocked(
    resolveModelIncrementalMessages({ sourceMessages: incrementalMessages, policyOptions }),
    systemIdentities,
  );
  const history = removeBlocked(
    resolveModelHistoryMessages({
      sourceMessages: historyMessages,
      historyLimit,
    }),
    new Set([...systemIdentities, ...identities(incremental)]),
  );
  return { system, history, incremental, messages: [...system, ...history, ...incremental] };
}
