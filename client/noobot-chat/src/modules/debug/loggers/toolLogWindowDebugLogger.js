/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

let sessionLogSink = null;

const text = (value) => String(value ?? "").trim();

export function summarizeToolLogWindowItem(item = {}, index = 0) {
  const content = text(
    item?.text ?? item?.output ?? item?.result ?? item?.data?.text ?? item?.data?.output,
  );
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
    textLength: content.length,
    textPreview: content.slice(0, 500),
  };
}

export function summarizeToolLogWindow(items = []) {
  return (Array.isArray(items) ? items : []).map(summarizeToolLogWindowItem);
}

export function setToolLogWindowDebugLogSink(sink = null) {
  sessionLogSink = sink && typeof sink.log === "function" ? sink : null;
}

export function logToolLogWindowDebug(event, payload = {}) {
  try {
    sessionLogSink?.log?.({
      category: "debug",
      level: "debug",
      debugType: "tool-log-window",
      event,
      sessionId: payload?.sessionId || "",
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: {
        debugType: "tool-log-window",
        event,
        at: new Date().toISOString(),
        ...payload,
      },
    });
  } catch {}
}
