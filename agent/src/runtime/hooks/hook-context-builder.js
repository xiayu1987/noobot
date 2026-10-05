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

const FORBIDDEN_HOOK_FIELDS = ["messages", "messageBlocks", "messageStore"];

function toFiniteNumberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function resolveToolName(raw = {}, call = null) {
  if (raw?.toolName) return String(raw.toolName || "").trim();
  return String(call?.name || "").trim() || null;
}

function assertNoForbiddenHookFields(safeRaw = {}) {
  for (const forbiddenField of FORBIDDEN_HOOK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(safeRaw, forbiddenField)) {
      throw new TypeError(`Hook Context V2 forbids top-level ${forbiddenField}`);
    }
  }
}

function pickNullable(raw = {}, keys = []) {
  return Object.fromEntries(keys.map((key) => [key, raw?.[key] ?? null]));
}

function normalizeToolCallFields(raw = {}) {
  const call = resolveCall(raw);
  return {
    calls: resolveCalls(raw),
    call,
    toolName: resolveToolName(raw, call),
    commitType: raw?.commitType ? String(raw.commitType || "").trim() : null,
  };
}

function normalizeHookFields(point = "", safeRaw = {}, hookFields = {}) {
  return {
    ...hookFields,
    point: String(point || safeRaw?.point || "").trim(),
    ...pickNullable(safeRaw, ["phase", "status", "startedAt", "endedAt"]),
    durationMs: toFiniteNumberOrNull(safeRaw?.durationMs),
    ...pickNullable(safeRaw, ["agentContext", "result", "error"]),
    turn: toFiniteNumberOrNull(safeRaw?.turn),
    mode: safeRaw?.mode ? String(safeRaw.mode) : null,
    ...normalizeToolCallFields(safeRaw),
    ...pickNullable(safeRaw, ["payload"]),
  };
}

function emitHookDocumentConsumed(runtime = {}, context = {}) {
  const modelContext = context.modelContext;
  const identity = modelContext?.activeTurnIdentity;
  emitAgentContextProtocolDebug(
    runtime?.eventListener || null,
    "hookDocumentConsumed",
    {
      userId: context.userId,
      sessionId: context.sessionId,
      dialogProcessId: identity?.dialogProcessId || context.dialogProcessId,
      turnScopeId: identity?.turnScopeId || context.turnScopeId,
    },
    {
      consumer: `hook:${context.point}`,
      contextProtocolVersion: context.contextProtocolVersion,
      hasModelContext: modelContext != null,
      modelContextProtocolVersion: Number(modelContext?.protocolVersion || 0),
      messageCount: Array.isArray(modelContext?.messages) ? modelContext.messages.length : 0,
    },
  );
}

function emitHookContextTrace(point = "", runtime = {}, context = {}) {
  const normalizedPoint = String(point || "").trim();
  if (normalizedPoint !== HOOK_POINT.AGENT.BEFORE_LLM_CALL) return;
  emitModelContextTrace(runtime, "hook_context_built", {
    point: normalizedPoint,
    mode: context.mode,
    turn: context.turn,
    contextBlocks: summarizeDiagnosticBlocks(context.modelContext?.messageBlocks),
    contextMessages: summarizeDiagnosticMessages(context.modelContext?.messages),
  });
}

export function buildHookContext(point = "", runtime = {}, raw = {}) {
  const safeRaw = asObject(raw);
  assertNoForbiddenHookFields(safeRaw);
  const { modelContext: suppliedModelContext, ...hookFields } = safeRaw;
  const modelContext = suppliedModelContext?.protocolVersion
    ? suppliedModelContext
    : runtime?.activeMessageContext;
  const context = withHookRuntimeMeta(runtime, normalizeHookFields(point, safeRaw, hookFields));
  attachModelContext(context, modelContext?.protocolVersion ? modelContext : null);
  emitHookDocumentConsumed(runtime, context);
  emitHookContextTrace(point, runtime, context);
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
  const warnings = [...validateHookContextProtocol(context, { point: normalizedPoint }).warnings];
  if (STATE_COMMIT_HOOK_POINTS.has(normalizedPoint) && context?.payload == null) {
    warnings.push("payload should be present");
  }
  if (!warnings.length) return;
  emitEvent(runtime?.eventListener || null, "hook_context_schema_warning", {
    point: normalizedPoint,
    warnings,
  });
}
