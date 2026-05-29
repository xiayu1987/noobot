/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { withHookRuntimeMeta } from "../../../hook/index.js";
import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../context/message-builder.js";
import { emitEvent } from "../../../event/index.js";

function asObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveHookMessages(raw = {}) {
  if (Array.isArray(raw?.messages)) return raw.messages;
  if (Array.isArray(raw?.modelMessages)) return raw.modelMessages;
  if (Array.isArray(raw?.loopState?.messages)) return raw.loopState.messages;
  if (Array.isArray(raw?.result?.modelMessages)) return raw.result.modelMessages;
  if (!raw?.agentContext) return null;
  try {
    return buildContextMessages(raw.agentContext, {
      currentUserMessage: String(raw?.userMessage || ""),
    });
  } catch {
    return null;
  }
}

function resolveHookMessageBlocks(raw = {}) {
  if (raw?.messageBlocks && typeof raw.messageBlocks === "object") {
    return raw.messageBlocks;
  }
  if (raw?.loopState?.messageBlocks && typeof raw.loopState.messageBlocks === "object") {
    return raw.loopState.messageBlocks;
  }
  if (!raw?.agentContext) return null;
  try {
    return buildContextMessageBlocks(raw.agentContext, {
      currentUserMessage: String(raw?.userMessage || ""),
    });
  } catch {
    return null;
  }
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
  const call = resolveCall(safeRaw);
  const merged = {
    ...safeRaw,
    point: String(point || safeRaw?.point || "").trim(),
    phase: safeRaw?.phase ?? null,
    status: safeRaw?.status ?? null,
    startedAt: safeRaw?.startedAt ?? null,
    endedAt: safeRaw?.endedAt ?? null,
    durationMs: Number.isFinite(Number(safeRaw?.durationMs)) ? Number(safeRaw.durationMs) : null,
    agentContext: safeRaw?.agentContext ?? null,
    messages: resolveHookMessages(safeRaw),
    messageBlocks: resolveHookMessageBlocks(safeRaw),
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
    requireArray("messages");
  }
  if (normalizedPoint === "before_tool_calls") {
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
