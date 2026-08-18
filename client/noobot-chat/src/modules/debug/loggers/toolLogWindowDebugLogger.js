/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { acceptsDebugSink, emitLazyDebug, isDebugTypeEnabled } from "./lazyDebugSink.js";

let sessionLogSink = null;

const text = (value) => String(value ?? "").trim();

export function summarizeToolLogWindowItem(item = {}, index = 0) {
  const content = text(
    item?.text ?? item?.output ?? item?.result ?? item?.data?.text ?? item?.data?.output,
  );
  const args = item?.args ?? item?.arguments ?? item?.data?.args ?? item?.data?.arguments;
  const result = item?.result ?? item?.output ?? item?.data?.result ?? item?.data?.output;
  const detail = item?.detailText ?? item?.detail;
  return {
    index,
    event: text(item?.event),
    type: text(item?.type),
    eventType: text(item?.eventType),
    sequence: item?.sequence ?? item?.seq ?? null,
    sequenceDomain: text(item?.sequenceDomain),
    sequenceScopeId: text(item?.sequenceScopeId || item?.sequenceScope || item?.messageId),
    authority: text(item?.authority),
    eventId: text(item?.eventId || item?.id),
    toolCallId: text(item?.toolCallId || item?.tool_call_id),
    tool: text(item?.tool || item?.toolName || item?.name),
    category: text(item?.category),
    hasArgs: args !== undefined && args !== null,
    hasResult: result !== undefined && result !== null,
    detailLength: text(detail).length,
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
  } catch { return false; }
}
