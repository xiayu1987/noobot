/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebug, isDebugTypeEnabled } from "./lazyDebugSink.js";

let sessionLogSink = null;

const text = (value) => String(value ?? "").trim();

const isPresent = (value) => value !== undefined && value !== null;

function firstPresent(source, keys) {
  for (const key of keys) {
    if (isPresent(source?.[key])) return source[key];
  }
  return undefined;
}

function firstTruthy(source, keys) {
  for (const key of keys) {
    if (source?.[key]) return source[key];
  }
  return source?.[keys.at(-1)];
}

function resolveContent(item) {
  return text(
    firstPresent(item, ["text", "output", "result"]) ??
      firstPresent(item?.data, ["text", "output"]),
  );
}

function resolveArgs(item) {
  return (
    firstPresent(item, ["args", "arguments"]) ?? firstPresent(item?.data, ["args", "arguments"])
  );
}

function resolveResult(item) {
  return firstPresent(item, ["result", "output"]) ?? firstPresent(item?.data, ["result", "output"]);
}

export function summarizeToolLogWindowItem(item = {}, index = 0) {
  const content = resolveContent(item);
  return {
    index,
    event: text(item?.event),
    type: text(item?.type),
    eventType: text(item?.eventType),
    sequence: firstPresent(item, ["sequence", "seq"]) ?? null,
    sequenceDomain: text(item?.sequenceDomain),
    sequenceScopeId: text(firstTruthy(item, ["sequenceScopeId", "sequenceScope", "messageId"])),
    authority: text(item?.authority),
    eventId: text(firstTruthy(item, ["eventId", "id"])),
    toolCallId: text(firstTruthy(item, ["toolCallId", "tool_call_id"])),
    tool: text(firstTruthy(item, ["tool", "toolName", "name"])),
    category: text(item?.category),
    hasArgs: isPresent(resolveArgs(item)),
    hasResult: isPresent(resolveResult(item)),
    detailLength: text(firstPresent(item, ["detailText", "detail"])).length,
    textLength: content.length,
    textPreview: content.slice(0, 500),
  };
}

export function summarizeToolLogWindow(items = [], limit = 20) {
  const source = Array.isArray(items) ? items : [];
  const start = Math.max(0, source.length - Math.max(1, Number(limit) || 20));
  return source.slice(start).map((item, index) => summarizeToolLogWindowItem(item, start + index));
}

export function setToolLogWindowDebugLogSink(sink = null) {
  sessionLogSink = acceptsDebugSink(sink) ? sink : null;
}

export function isToolLogWindowDebugEnabled() {
  return isDebugTypeEnabled(sessionLogSink, "tool-log-window");
}

export function logToolLogWindowDebug(event, payload = {}) {
  try {
    return emitLazyDebug(sessionLogSink, "tool-log-window", event, payload);
  } catch {
    return false;
  }
}
