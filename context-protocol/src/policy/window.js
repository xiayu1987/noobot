/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  isContextSystemMessage,
  resolveContextMessageDialogProcessId,
  resolveContextMessageId,
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
  const explicitId = resolveContextMessageId(message);
  return explicitId ? `id:${explicitId}` : "";
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

/**
 * System and incremental blocks apply the same model-context filter today but
 * remain separate entry points because they are distinct protocol blocks.
 */
function resolveModelBlockMessages({ sourceMessages = [], policyOptions = {} } = {}) {
  return filterForModelContext(sourceMessages, policyOptions);
}

export function resolveModelSystemMessages(options = {}) {
  return resolveModelBlockMessages(options);
}

export function resolveModelHistoryMessages({
  sourceMessages = [],
  historyLimit = Number.POSITIVE_INFINITY,
  resolveHistoryDialogProcessId = resolveContextMessageDialogProcessId,
} = {}) {
  const resolveDialog =
    typeof resolveHistoryDialogProcessId === "function"
      ? resolveHistoryDialogProcessId
      : resolveContextMessageDialogProcessId;
  const source = (Array.isArray(sourceMessages) ? sourceMessages : []).filter((message) => {
    if (!resolveDialog(message)) return false;
    if (isContextSystemMessage(message)) return false;
    return !resolveContextMessageSummarized(message);
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

export function resolveModelIncrementalMessages(options = {}) {
  return resolveModelBlockMessages(options);
}

export function resolveModelFinalMessages({
  systemMessages = [],
  historyMessages = [],
  incrementalMessages = [],
  historyLimit = Number.POSITIVE_INFINITY,
  policyOptions = {},
  resolveHistoryDialogProcessId = resolveContextMessageDialogProcessId,
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
      resolveHistoryDialogProcessId,
    }),
    new Set([...systemIdentities, ...identities(incremental)]),
  );
  return { system, history, incremental, messages: [...system, ...history, ...incremental] };
}

export function materializeModelContext(context = {}) {
  if (Number(context?.protocolVersion) !== 3) {
    throw new Error("materializeModelContext requires modelContext protocolVersion=3");
  }
  const blocks =
    context?.messageBlocks && typeof context.messageBlocks === "object"
      ? context.messageBlocks
      : {};
  return resolveModelFinalMessages({
    systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
    historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
    incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  });
}
