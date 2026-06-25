/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { replaceMessages } from "./message-store.js";
import { emitModelContextTrace, summarizeDiagnosticBlocks, summarizeDiagnosticMessages } from "../../../../agent/src/system-core/agent/core/message-context/context-diagnostics.js";


function emitHarnessModelContextTrace(ctx = {}, stage = "", payload = {}) {
  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  emitModelContextTrace(runtime, stage, {
    source: "harness",
    point: ctx?.point || "",
    turn: ctx?.turn ?? null,
    mode: ctx?.mode || "",
    ...payload,
  });
}

export function applyAgentResolvedModelMessages(point = "", ctx = {}, options = {}) {
  if (String(point || "").trim().toLowerCase() !== "before_llm_call") return false;
  if (!ctx || typeof ctx !== "object" || !Array.isArray(ctx.messages)) return false;
  const resolver = options?.resolveModelMessages || options?.harness?.resolveModelMessages;
  if (typeof resolver !== "function") return false;
  emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_before", {
    blocks: summarizeDiagnosticBlocks(ctx.messageBlocks),
    messages: summarizeDiagnosticMessages(ctx.messages),
  });
  let resolved = null;
  try {
    resolved = resolver({ ctx, messages: [], purpose: "main_agent" });
  } catch (error) {
    emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_error", {
      error: String(error?.message || error || ""),
      blocks: summarizeDiagnosticBlocks(ctx.messageBlocks),
      messages: summarizeDiagnosticMessages(ctx.messages),
    });
    return false;
  }
  if (!Array.isArray(resolved)) return false;
  emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_after_resolver", {
    blocks: summarizeDiagnosticBlocks(ctx.messageBlocks),
    resolvedMessages: summarizeDiagnosticMessages(resolved),
  });
  replaceMessages(ctx, resolved);
  emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_after_replace", {
    blocks: summarizeDiagnosticBlocks(ctx.messageBlocks),
    messages: summarizeDiagnosticMessages(ctx.messages),
  });
  return true;
}
