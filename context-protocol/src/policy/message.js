/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONTEXT_MESSAGE_ROLE,
  isContextSystemMessage,
  normalizeContextMessageRole,
  readContextMessageField,
  resolveContextMessageFlags,
  resolveContextMessageRole,
  resolveContextMessageSummarized,
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
  resolveContextToolCalls,
} from "../message/codec.js";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "../message/internal-types.js";
import { recoverContextTaskSummaryToolResult } from "../task/summary-context.js";
import { text } from "@noobot/shared/value";

export function isSystemLikeMessageRole(role = "") {
  return normalizeContextMessageRole(role) === CONTEXT_MESSAGE_ROLE.SYSTEM;
}

export function isCurrentSystemContextMessage(message = {}) {
  return (
    readContextMessageField(message, "noobotInternalMessageType") ===
    CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT
  );
}

export function isInjectedMessage(message = {}) {
  return resolveContextMessageFlags(message).injected;
}

export function isInjectedOrPluginMessage(message = {}) {
  const flags = resolveContextMessageFlags(message);
  return flags.injected || flags.plugin;
}

export function isDialogAnchorMessage(message = {}) {
  if (text(message?.role) !== "user") return false;
  if (isInjectedOrPluginMessage(message)) return false;
  if (text(message?.injectedMessageType)) return false;
  return text(message?.messageOrigin).toLowerCase() !== "internal";
}

export const SESSION_AUTO_TITLE_MAX_LENGTH = 20;

export function resolveSessionAutoTitle(message = {}) {
  if (message?.injectedMessage === true) return "";
  if (text(message?.role).toLowerCase() !== "user") return "";
  if (!text(message?.content)) return "";
  return String(message.content).slice(0, SESSION_AUTO_TITLE_MAX_LENGTH);
}

export function deriveSessionAutoTitle(messages = []) {
  for (const message of Array.isArray(messages) ? messages : []) {
    const title = resolveSessionAutoTitle(message);
    if (title) return title;
  }
  return "";
}

export function resolveInjectedMessageType(message = {}) {
  if (!isInjectedMessage(message)) return "";
  const explicit = readContextMessageField(message, "injectedMessageType");
  if (explicit) return explicit;
  const generic = text(message?.type || message?.lc_kwargs?.type);
  if (generic && generic !== "message") return generic;
  return readContextMessageField(message, "injectedBy") || "injected_message";
}

function shouldKeepForModelContext(message = {}) {
  if (
    resolveContextMessageSummarized(message) &&
    isContextSystemMessage(message) &&
    isCurrentSystemContextMessage(message)
  )
    return true;
  return !resolveContextMessageSummarized(message);
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
    const role = resolveContextMessageRole(message);
    if (role === "assistant")
      resolveContextToolCalls(message)
        .map(resolveContextToolCallDeclarationId)
        .filter(Boolean)
        .forEach((id) => assistantIds.add(id));
    if (role === "tool") {
      const id = resolveContextToolResultCallId(message);
      if (id) resultIds.add(id);
    }
  }
  const validIds = new Set([...assistantIds].filter((id) => resultIds.has(id)));
  const result = [];
  for (const message of source) {
    const role = resolveContextMessageRole(message);
    if (role === "tool") {
      const id = resolveContextToolResultCallId(message);
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
    const calls = resolveContextToolCalls(message);
    if (!calls.length) {
      result.push(message);
      continue;
    }
    const ids = calls.map(resolveContextToolCallDeclarationId).filter(Boolean);
    if (ids.length && ids.every((id) => validIds.has(id))) result.push(message);
  }
  return result;
}

export function shouldMarkCurrentTurnSummarizedByPolicy(message = {}) {
  const role = resolveContextMessageRole(message);
  if (role === CONTEXT_MESSAGE_ROLE.USER) return false;
  if (role === CONTEXT_MESSAGE_ROLE.ASSISTANT) return resolveContextToolCalls(message).length > 0;
  return role === CONTEXT_MESSAGE_ROLE.TOOL || role === CONTEXT_MESSAGE_ROLE.SYSTEM;
}
