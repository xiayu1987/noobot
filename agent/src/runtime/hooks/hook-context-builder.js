/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { withHookRuntimeMeta } from "../../extensions/hooks/index.js";
import { emitEvent } from "../../events/index.js";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/assembly/diagnostics";
import {
  attachModelContext,
  validateHookContextProtocol,
} from "@noobot/context-protocol/assembly/hook-context";
import { emitAgentContextProtocolDebug } from "../../observability/agent-context-protocol-debug.js";
import { HOOK_POINT } from "@noobot/hook-protocol";

const MODEL_HOOK_POINTS = new Set([
  HOOK_POINT.AGENT.BEFORE_TURN,
  HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
  HOOK_POINT.AGENT.AFTER_TURN,
  HOOK_POINT.AGENT.BEFORE_LLM_CALL,
  HOOK_POINT.AGENT.AFTER_LLM_CALL,
  HOOK_POINT.AGENT.LLM_CALL_ERROR,
]);
const TOOL_CALL_COLLECTION_HOOK_POINTS = new Set([
  HOOK_POINT.AGENT.BEFORE_TOOL_CALLS,
  HOOK_POINT.AGENT.AFTER_TOOL_CALLS,
]);
const TOOL_CALL_HOOK_POINTS = new Set([
  HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
  HOOK_POINT.AGENT.AFTER_TOOL_CALL,
  HOOK_POINT.AGENT.TOOL_CALL_ERROR,
]);
const STATE_COMMIT_HOOK_POINTS = new Set([
  HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
  HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
]);

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
  for (const forbiddenField of ["messages", "messageBlocks", "messageStore"]) {
    if (Object.prototype.hasOwnProperty.call(safeRaw, forbiddenField)) {
      throw new TypeError(`Hook Context V2 forbids top-level ${forbiddenField}`);
    }
  }
  const { modelContext: suppliedModelContext, ...hookFields } = safeRaw;
  const modelContext = suppliedModelContext?.protocolVersion
    ? suppliedModelContext
    : runtime?.activeMessageContext;
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
  attachModelContext(context, modelContext?.protocolVersion ? modelContext : null);
  emitAgentContextProtocolDebug(
    runtime?.eventListener || null,
    "hookDocumentConsumed",
    {
      userId: context.userId,
      sessionId: context.sessionId,
      dialogProcessId:
        context.modelContext?.activeTurnIdentity?.dialogProcessId || context.dialogProcessId,
      turnScopeId: context.modelContext?.activeTurnIdentity?.turnScopeId || context.turnScopeId,
    },
    {
      consumer: `hook:${context.point}`,
      contextProtocolVersion: context.contextProtocolVersion,
      hasModelContext: context.modelContext != null,
      modelContextProtocolVersion: Number(context.modelContext?.protocolVersion || 0),
      messageCount: Array.isArray(context.modelContext?.messages)
        ? context.modelContext.messages.length
        : 0,
    },
  );
  if (String(point || "").trim() === HOOK_POINT.AGENT.BEFORE_LLM_CALL) {
    emitModelContextTrace(runtime, "hook_context_built", {
      point: String(point || "").trim(),
      mode: context.mode,
      turn: context.turn,
      rawHadMessages: Array.isArray(safeRaw?.messages),
      rawHadMessageBlocks: Boolean(
        safeRaw?.messageBlocks && typeof safeRaw.messageBlocks === "object",
      ),
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

  if (MODEL_HOOK_POINTS.has(normalizedPoint)) {
    if (context.modelContext?.messages != null && !Array.isArray(context.modelContext.messages)) {
      warnings.push("modelContext.messages should be array");
    }
  }
  if (TOOL_CALL_COLLECTION_HOOK_POINTS.has(normalizedPoint)) {
    requireArray("calls");
  }
  if (TOOL_CALL_HOOK_POINTS.has(normalizedPoint)) {
    requireObject("call");
    requireString("toolName");
  }
  if (STATE_COMMIT_HOOK_POINTS.has(normalizedPoint)) {
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
