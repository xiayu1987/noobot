/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { withHookRuntimeMeta } from "../../extensions/hooks/index.js";
import { emitEvent } from "../../events/index.js";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import { summarizeDiagnosticBlocks, summarizeDiagnosticMessages } from "@noobot/context-protocol/context-diagnostics";
import {
  attachModelContext,
  validateHookContextProtocol,
} from "@noobot/context-protocol/hook-context";

function asObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveCalls(raw = {}) {
  if (Array.isArray(raw?.calls)) return raw.calls;
  if (Array.isArray(raw?.call)) return raw.call;
  return null;
}

function resolveCall(raw = {}) {
  const directCall = asObject(raw?.call);
  if (Object.keys(directCall).length) return directCall;
  if (Array.isArray(raw?.calls) && raw.calls.length) {
    return asObject(raw.calls[0]);
  }
  return null;
}

export function buildHookContext(point = "", runtime = {}, raw = {}) {
  const safeRaw = asObject(raw);
  const {
    modelContext: suppliedModelContext,
    messages: _legacyMessages,
    messageBlocks: _legacyMessageBlocks,
    messageStore: _legacyMessageStore,
    ...hookFields
  } = safeRaw;
  const call = resolveCall(safeRaw);
  const merged = {
    ...hookFields,
    point: String(point || safeRaw?.point || "").trim(),
    phase: safeRaw?.phase ?? null,
    status: safeRaw?.status ?? null,
    startedAt: safeRaw?.startedAt ?? null,
    endedAt: safeRaw?.endedAt ?? null,
    durationMs: Number.isFinite(Number(safeRaw?.durationMs)) ? Number(safeRaw.durationMs) : null,
    agentContext: safeRaw?.agentContext ?? null,
    result: safeRaw?.result ?? null,
    error: safeRaw?.error ?? null,
    turn: Number.isFinite(Number(safeRaw?.turn)) ? Number(safeRaw.turn) : null,
    mode: safeRaw?.mode ? String(safeRaw.mode) : null,
    calls: resolveCalls(safeRaw),
    call,
    toolName: safeRaw?.toolName
      ? String(safeRaw.toolName || "").trim()
      : String(call?.name || "").trim() || null,
    commitType: safeRaw?.commitType ? String(safeRaw.commitType || "").trim() : null,
    payload: safeRaw?.payload ?? null,
  };
  const context = withHookRuntimeMeta(runtime, merged);
  attachModelContext(context, suppliedModelContext?.protocolVersion ? suppliedModelContext : null);
  if (String(point || "").trim() === "before_llm_call") {
    emitModelContextTrace(runtime, "hook_context_built", {
      point: String(point || "").trim(),
      mode: context.mode,
      turn: context.turn,
      rawHadMessages: Array.isArray(safeRaw?.messages),
      rawHadMessageBlocks: Boolean(safeRaw?.messageBlocks && typeof safeRaw.messageBlocks === "object"),
      contextBlocks: summarizeDiagnosticBlocks(context.modelContext?.messageBlocks),
      contextMessages: summarizeDiagnosticMessages(context.modelContext?.messages),
    });
  }
  validateHookContext(point, runtime, context);
  return context;
}

function isValidationEnabled(runtime = {}) {
  const explicit = runtime?.systemRuntime?.hookSchemaValidation;
  if (explicit === false) return false;
  if (explicit === true) return true;
  return process.env.NODE_ENV !== "production";
}

function validateHookContext(point = "", runtime = {}, context = {}) {
  if (!isValidationEnabled(runtime)) return;
  const normalizedPoint = String(point || "").trim();
  if (!normalizedPoint) return;
  const warnings = [];
  warnings.push(...validateHookContextProtocol(context, { point: normalizedPoint }).warnings);
  const requireArray = (key) => {
    if (context?.[key] == null) return;
    if (!Array.isArray(context[key])) warnings.push(`${key} should be array`);
  };
  const requireObject = (key) => {
    if (context?.[key] == null) return;
    const value = context[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      warnings.push(`${key} should be object`);
    }
  };
  const requireString = (key) => {
    if (context?.[key] == null) return;
    if (typeof context[key] !== "string") warnings.push(`${key} should be string`);
  };

  if (
    normalizedPoint === "before_turn" ||
    normalizedPoint === "before_final_output" ||
    normalizedPoint === "after_turn" ||
    normalizedPoint === "before_llm_call" ||
    normalizedPoint === "after_llm_call" ||
    normalizedPoint === "llm_call_error"
  ) {
    if (context.modelContext?.messages != null && !Array.isArray(context.modelContext.messages)) {
      warnings.push("modelContext.messages should be array");
    }
  }
  if (
    normalizedPoint === "before_tool_calls" ||
    normalizedPoint === "after_tool_calls"
  ) {
    requireArray("calls");
  }
  if (
    normalizedPoint === "before_tool_call" ||
    normalizedPoint === "after_tool_call" ||
    normalizedPoint === "tool_call_error"
  ) {
    requireObject("call");
    requireString("toolName");
  }
  if (
    normalizedPoint === "before_state_commit" ||
    normalizedPoint === "after_state_commit"
  ) {
    requireString("commitType");
    if (context?.payload == null) {
      warnings.push("payload should be present");
    }
  }

  if (!warnings.length) return;
  emitEvent(runtime?.eventListener || null, "hook_context_schema_warning", {
    point: normalizedPoint,
    warnings,
  });
}
