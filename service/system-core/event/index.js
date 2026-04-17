/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const TOOL_EVENT_TYPES = new Set(["tool_call", "tool_result"]);

export function emitEvent(eventListener, event, data = {}) {
  try {
    eventListener?.onEvent?.({ event, data, ts: new Date().toISOString() });
  } catch {
    // ignore listener errors
  }
}

export function classifyExecutionEvent(event = "") {
  if (event === "tool_call_start")
    return { category: "tool", type: "tool_call" };
  if (event === "tool_call_end")
    return { category: "tool", type: "tool_result" };
  return { category: "system", type: "system" };
}

export function createExecutionEventListener({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  upstream = null,
}) {
  const dialogProcessId = upstream?.dialogProcessId || "";
  return {
    onEvent: (evt = {}) => {
      const event = evt?.event || "";
      const data = evt?.data || {};
      const ts = evt?.ts || new Date().toISOString();
      if (event === "llm_delta") {
        try {
          upstream?.onEvent?.({
            event,
            data: { ...data, dialogProcessId },
            ts,
          });
        } catch {
          // ignore upstream listener errors
        }
        return;
      }

      const { category, type } = classifyExecutionEvent(event);
      try {
        sessionManager?.appendExecutionLog?.({
          userId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          event,
          category,
          type,
          data,
          ts,
        });
      } catch {
        // ignore log write errors
      }

      try {
        upstream?.onEvent?.({
          event,
          data: { ...data, dialogProcessId },
          ts,
        });
      } catch {
        // ignore upstream listener errors
      }
    },
  };
}

export function normalizeSseLogEvent(evt = {}) {
  const rawEvent = String(evt?.event || "");
  const data = evt?.data || {};
  const ts = evt?.ts || new Date().toISOString();

  if (rawEvent === "tool_call_start") {
    return {
      event: "thinking",
      data: {
        category: "tool",
        type: "tool_call",
        event: "tool_call",
        rawEvent,
        dialogProcessId: data.dialogProcessId || "",
        ts,
        turn: data.turn || 0,
        tool: data.tool || "",
        args: data.args || {},
        text: `${data.tool || ""} ${JSON.stringify(data.args || {})}`,
      },
    };
  }

  if (rawEvent === "tool_call_end") {
    return {
      event: "thinking",
      data: {
        category: "tool",
        type: "tool_result",
        event: "tool_result",
        rawEvent,
        dialogProcessId: data.dialogProcessId || "",
        ts,
        turn: data.turn || 0,
        tool: data.tool || "",
        result: data.result || "",
        text: `${data.tool || ""} ${String(data.result || "")}`,
      },
    };
  }

  return {
    event: "thinking",
    data: {
      category: TOOL_EVENT_TYPES.has(String(data.type || ""))
        ? "tool"
        : "system",
      type: String(data.type || "system"),
      event: String(data.event || "system"),
      rawEvent: rawEvent || "system",
      ts,
      ...data,
      text: `${rawEvent || "system"} ${JSON.stringify(data)}`,
    },
  };
}

export function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
