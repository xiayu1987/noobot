/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { replaceMessageProjection } from "./message-store.js";
import {
  resolveAuthoritativeModelContext,
  resolveModelContextTraceEmitter,
} from "@noobot/context-protocol/assembly/hook-context";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/assembly/diagnostics";

function emitHarnessModelContextTrace(ctx = {}, stage = "", payload = {}) {
  const emit = resolveModelContextTraceEmitter(ctx);
  if (!emit) return false;
  emit(stage, {
    source: "harness",
    point: ctx?.point || "",
    turn: ctx?.turn ?? null,
    mode: ctx?.mode || "",
    ...payload,
  });
  return true;
}

export function applyAgentResolvedModelMessages(point = "", ctx = {}, options = {}) {
  if (
    String(point || "")
      .trim()
      .toLowerCase() !== HOOK_POINT.AGENT.BEFORE_LLM_CALL
  )
    return false;
  const modelContext = resolveAuthoritativeModelContext(ctx);
  if (!modelContext || !Array.isArray(modelContext.messages)) return false;
  const resolver = options?.resolveModelMessages || options?.harness?.resolveModelMessages;
  if (typeof resolver !== "function") return false;
  emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_before", {
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    messages: summarizeDiagnosticMessages(modelContext.messages),
  });
  let resolved = null;
  try {
    resolved = resolver({ ctx, messages: [], purpose: "main_agent" });
  } catch (error) {
    emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_error", {
      error: String(error?.message || error || ""),
      blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
      messages: summarizeDiagnosticMessages(modelContext.messages),
    });
    return false;
  }
  if (!Array.isArray(resolved)) return false;
  emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_after_resolver", {
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    resolvedMessages: summarizeDiagnosticMessages(resolved),
  });
  replaceMessageProjection(ctx, resolved);
  emitHarnessModelContextTrace(ctx, "harness_apply_agent_resolved_after_replace", {
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    messages: summarizeDiagnosticMessages(modelContext.messages),
  });
  return true;
}
