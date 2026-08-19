/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  readContextMessageField,
  resolveContextMessageDialogProcessId,
  resolveContextMessageFlags,
  resolveContextMessageId,
  resolveContextMessageRole,
  resolveContextToolCallId,
  resolveContextToolCalls,
} from "../message/codec.js";
import { recoverContextTaskSummaryToolResult } from "../task/summary-context.js";

function text(value) {
  return String(value || "").trim();
}

export function readMessageField(message = {}, field = "") {
  return readContextMessageField(message, field);
}

export function resolveMessageId(message = {}) {
  return resolveContextMessageId(message);
}

export function resolveMessageDialogProcessId(message = {}) {
  return resolveContextMessageDialogProcessId(message);
}

export function resolveMessageRole(message = {}) {
  return resolveContextMessageRole(message);
}

export function getMessageToolCalls(message = {}) {
  return resolveContextToolCalls(message);
}

export function resolveToolCallId(value = {}) {
  return resolveContextToolCallId(value);
}

export function isSystemLikeMessageRole(role = "") {
  const normalized = text(role).toLowerCase();
  return normalized === "system" || normalized === "developer";
}

export function isMessageSummarized(message = {}) {
  return resolveContextMessageFlags(message).summarized;
}

export function isCurrentSystemContextMessage(message = {}) {
  return readMessageField(message, "noobotInternalMessageType") === "system_context";
}

export function isInjectedMessage(message = {}) {
  return resolveContextMessageFlags(message).injected;
}

export function resolveInjectedMessageType(message = {}) {
  if (!isInjectedMessage(message)) return "";
  const explicit =
    readMessageField(message, "injectedMessageType") ||
    readMessageField(message, "injected_message_type") ||
    readMessageField(message, "noobotInternalMessageType");
  if (explicit) return explicit;
  const generic = text(message?.type || message?.lc_kwargs?.type);
  if (generic && generic !== "message") return generic;
  return readMessageField(message, "injectedBy") || "injected_message";
}

export function shouldKeepForModelContext(message = {}) {
  if (
    isMessageSummarized(message) &&
    isSystemLikeMessageRole(resolveMessageRole(message)) &&
    isCurrentSystemContextMessage(message)
  )
    return true;
  return !isMessageSummarized(message);
}

export function filterForModelContext(
  messages = [],
  { recoverUnpairedToolResult = recoverContextTaskSummaryToolResult } = {},
) {
  const kept = (Array.isArray(messages) ? messages : []).filter((message) => {
    const placeholder =
      message?.turnStatusPlaceholder === true ||
      Boolean(
        message?.synthetic === true &&
        message?.placeholder === true &&
        message?.turnStatus &&
        typeof message.turnStatus === "object",
      );
    return !placeholder && shouldKeepForModelContext(message);
  });
  const source = kept;
  const assistantIds = new Set();
  const resultIds = new Set();
  for (const message of source) {
    const role = resolveMessageRole(message);
    if (role === "assistant")
      getMessageToolCalls(message)
        .map(resolveToolCallId)
        .filter(Boolean)
        .forEach((id) => assistantIds.add(id));
    if (role === "tool") {
      const id = resolveToolCallId(message);
      if (id) resultIds.add(id);
    }
  }
  const validIds = new Set([...assistantIds].filter((id) => resultIds.has(id)));
  const result = [];
  for (const message of source) {
    const role = resolveMessageRole(message);
    if (role === "tool") {
      const id = resolveToolCallId(message);
      if (id && validIds.has(id)) result.push(message);
      else if (typeof recoverUnpairedToolResult === "function") {
        const recovered = recoverUnpairedToolResult(message);
        if (recovered) result.push(recovered);
      }
      continue;
    }
    if (role !== "assistant") {
      result.push(message);
      continue;
    }
    const calls = getMessageToolCalls(message);
    if (!calls.length) {
      result.push(message);
      continue;
    }
    const ids = calls.map(resolveToolCallId).filter(Boolean);
    if (ids.length && ids.every((id) => validIds.has(id))) result.push(message);
  }
  return result;
}

export function shouldMarkCurrentTurnSummarizedByPolicy(message = {}) {
  const role = resolveMessageRole(message);
  if (role === "user") return false;
  if (role === "assistant") return getMessageToolCalls(message).length > 0;
  return role === "tool" || isSystemLikeMessageRole(role);
}
