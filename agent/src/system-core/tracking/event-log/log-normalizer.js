/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * SSE log event normalization & execution event classification.
 */

import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";

const TOOL_EVENT_TYPES = new Set(["tool_call", "tool_result"]);
const ERROR_EVENT_SUFFIX_RE = /(_error|_aborted)$/i;

function resolveErrorType(rawEvent = "") {
  const normalized = String(rawEvent || "").toLowerCase();
  if (normalized.includes("llm")) return "llm_error";
  if (normalized.includes("tool")) return "tool_error";
  if (normalized.includes("orchestrator")) return "orchestrator_error";
  return "error";
}

function normalizeErrorEvent(rawEvent = "", data = {}, ts = "") {
  const errorInfo =
    data?.error && typeof data.error === "object" ? data.error : {};
  const classification = String(
    errorInfo?.classification || data?.classification || "fatal",
  ).trim();
  const message = String(
    errorInfo?.message || data?.message || rawEvent || "error",
  ).trim();

  return {
    event: "thinking",
    data: {
      category: "error",
      type: resolveErrorType(rawEvent),
      event: "error",
      rawEvent: rawEvent || "error",
      ts,
      ...data,
      classification,
      retryable:
        typeof errorInfo?.retryable === "boolean"
          ? errorInfo.retryable
          : classification === "retryable",
      fatal:
        typeof errorInfo?.fatal === "boolean"
          ? errorInfo.fatal
          : classification === "fatal",
      abort:
        typeof errorInfo?.abort === "boolean"
          ? errorInfo.abort
          : classification === "abort",
      text: `${rawEvent || "error"} ${message}`,
    },
  };
}

export function classifyExecutionEvent(event = "") {
  if (event === "tool_call_start")
    return { category: "tool", type: "tool_call" };
  if (event === "tool_call_end")
    return { category: "tool", type: "tool_result" };
  if (ERROR_EVENT_SUFFIX_RE.test(event))
    return { category: "error", type: resolveErrorType(event) };
  return { category: "system", type: "system" };
}

export function normalizeSseLogEvent(evt = {}) {
  const rawEvent = String(evt?.event || "");
  const data = evt?.data || {};
  const ts = evt?.ts || new Date().toISOString();

  if (ERROR_EVENT_SUFFIX_RE.test(rawEvent)) {
    return normalizeErrorEvent(rawEvent, data, ts);
  }

  if (rawEvent === "tool_call_start") {
    const dialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId: data.dialogProcessId,
    });
    return {
      event: "thinking",
      data: {
        category: "tool",
        type: "tool_call",
        event: "tool_call",
        rawEvent,
        dialogProcessId,
        ts,
        turn: data.turn || 0,
        tool: data.tool || "",
        args: data.args || {},
        text: `${data.tool || ""} ${JSON.stringify(data.args || {})}`,
      },
    };
  }

  if (rawEvent === "tool_call_end") {
    const dialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId: data.dialogProcessId,
    });
    return {
      event: "thinking",
      data: {
        category: "tool",
        type: "tool_result",
        event: "tool_result",
        rawEvent,
        dialogProcessId,
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
