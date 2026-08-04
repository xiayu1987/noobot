/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const ERROR_EVENT_SUFFIX_RE = /(_error|_aborted)$/i;
const SEMANTIC_TRANSFER_EVENTS = new Set([
  "semantic_transfer_validation",
  "semantic_transfer_legacy_input_warning",
]);

function resolveErrorType(rawEvent = "") {
  const normalized = String(rawEvent || "").toLowerCase();
  if (normalized.includes("llm")) return "llm_error";
  if (normalized.includes("tool")) return "tool_error";
  if (normalized.includes("orchestrator")) return "orchestrator_error";
  return "error";
}

export function classifyExecutionEvent(event = "") {
  if (String(event || "").startsWith("agent.contextIdentity.")) {
    return { category: "context_identity", type: "context_identity_debug" };
  }
  if (SEMANTIC_TRANSFER_EVENTS.has(String(event || "").trim())) {
    return { category: "semantic_transfer", type: "semantic_transfer" };
  }
  if (event === "tool_call_start") return { category: "tool", type: "tool_call" };
  if (event === "tool_call_end") return { category: "tool", type: "tool_result" };
  if (ERROR_EVENT_SUFFIX_RE.test(event)) {
    return { category: "error", type: resolveErrorType(event) };
  }
  return { category: "system", type: "system" };
}
