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
const SEMANTIC_TRANSFER_EVENTS = new Set([
  "semantic_transfer_validation",
  "semantic_transfer_legacy_input_warning",
]);

function buildToolText(tool = "", suffix = "") {
  return [String(tool || "").trim(), String(suffix || "").trim()]
    .filter(Boolean)
    .join(" ");
}

function hasSemanticTransferInfo(value = {}) {
  return Boolean(
    (Array.isArray(value?.transferEnvelopes) && value.transferEnvelopes.length > 0) ||
      (Array.isArray(value?.transferFiles) && value.transferFiles.length > 0) ||
      value?.resultTransfer ||
      value?.toolResultTransfer,
  );
}

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
  if (SEMANTIC_TRANSFER_EVENTS.has(String(event || "").trim())) {
    return { category: "semantic_transfer", type: "semantic_transfer" };
  }
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

  if (SEMANTIC_TRANSFER_EVENTS.has(rawEvent)) {
    const semanticType =
      rawEvent === "semantic_transfer_legacy_input_warning"
        ? "legacy_input_warning"
        : "validation";
    return {
      event: "thinking",
      data: {
        category: "semantic_transfer",
        type: "semantic_transfer",
        event: "semantic_transfer",
        semanticTransferType: semanticType,
        rawEvent,
        ts,
        ...data,
        text: `${rawEvent} ${JSON.stringify(data || {})}`,
      },
    };
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
        text: buildToolText(data.tool, "started"),
      },
    };
  }

  if (rawEvent === "tool_call_end") {
    const dialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId: data.dialogProcessId,
    });
    const result = data.result || "";
    const resultText = hasSemanticTransferInfo(result)
      ? "completed semantic-transfer"
      : "completed";

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
        result,
        text: buildToolText(data.tool, resultText),
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
      text: String(rawEvent || data.event || data.type || "system"),
    },
  };
}
