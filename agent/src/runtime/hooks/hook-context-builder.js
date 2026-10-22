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
import { readActiveModelContext } from "../active-model-context.js";
import { isPlainObject, text } from "@noobot/shared/value";

const STATE_COMMIT_HOOK_POINTS = new Set([
  HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
  HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
]);

function assertHookRaw(raw) {
  if (!isPlainObject(raw)) throw new TypeError("hook context raw fields must be a plain object");
  if (raw.calls !== undefined && !Array.isArray(raw.calls)) {
    throw new TypeError("hook context calls must be an array");
  }
  if (raw.call !== undefined && !isPlainObject(raw.call)) {
    throw new TypeError("hook context call must be a plain object");
  }
}

const FORBIDDEN_HOOK_FIELDS = ["messages", "messageBlocks", "messageStore", "modelContext"];

function toFiniteNumberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function assertNoForbiddenHookFields(safeRaw) {
  for (const forbiddenField of FORBIDDEN_HOOK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(safeRaw, forbiddenField)) {
      throw new TypeError(`Hook Context V2 forbids top-level ${forbiddenField}`);
    }
  }
}

function pickNullable(raw = {}, keys = []) {
  return Object.fromEntries(keys.map((key) => [key, raw?.[key] ?? null]));
}

function normalizeToolCallFields(raw) {
  return {
    calls: raw.calls ?? null,
    call: raw.call ?? null,
    toolName: raw.toolName ? text(raw.toolName) : null,
    commitType: raw.commitType ? text(raw.commitType) : null,
  };
}

function normalizeHookFields(point, safeRaw, hookFields) {
  return {
    ...hookFields,
    point: text(point),
    ...pickNullable(safeRaw, ["phase", "status", "startedAt", "endedAt"]),
    durationMs: toFiniteNumberOrNull(safeRaw?.durationMs),
    ...pickNullable(safeRaw, ["agentContext", "result", "error"]),
    turn: toFiniteNumberOrNull(safeRaw?.turn),
    mode: safeRaw?.mode ? String(safeRaw.mode) : null,
    ...normalizeToolCallFields(safeRaw),
    ...pickNullable(safeRaw, ["payload"]),
  };
}

function emitHookDocumentConsumed(runtime, context) {
  const modelContext = context.modelContext;
  emitAgentContextProtocolDebug(runtime.eventListener, "hookDocumentConsumed", {
    consumer: `hook:${context.point}`,
    contextProtocolVersion: context.contextProtocolVersion,
    hasModelContext: modelContext != null,
    modelContextProtocolVersion: Number(modelContext?.protocolVersion || 0),
    messageCount: Array.isArray(modelContext?.messages) ? modelContext.messages.length : 0,
  });
}

function emitHookContextTrace(point, runtime, context) {
  const normalizedPoint = text(point);
  if (normalizedPoint !== HOOK_POINT.AGENT.BEFORE_LLM_CALL) return;
  emitModelContextTrace(runtime.eventListener, "hook_context_built", {
    point: normalizedPoint,
    mode: context.mode,
    turn: context.turn,
    contextBlocks: summarizeDiagnosticBlocks(context.modelContext?.messageBlocks),
    contextMessages: summarizeDiagnosticMessages(context.modelContext?.messages),
  });
}

export function buildHookContext(point, runtime, raw) {
  assertHookRaw(raw);
  assertNoForbiddenHookFields(raw);
  const context = withHookRuntimeMeta(runtime, normalizeHookFields(point, raw, raw));
  attachModelContext(context, readActiveModelContext(runtime));
  emitHookDocumentConsumed(runtime, context);
  emitHookContextTrace(point, runtime, context);
  validateHookContext(point, runtime, context);
  return context;
}

function isValidationEnabled(runtime) {
  const explicit = runtime.systemRuntime.hookSchemaValidation;
  if (explicit === false) return false;
  if (explicit === true) return true;
  return process.env.NODE_ENV !== "production";
}

function validateHookContext(point, runtime, context) {
  if (!isValidationEnabled(runtime)) return;
  const normalizedPoint = text(point);
  if (!normalizedPoint) return;
  const warnings = [...validateHookContextProtocol(context, { point: normalizedPoint }).warnings];
  if (STATE_COMMIT_HOOK_POINTS.has(normalizedPoint) && context.payload == null) {
    warnings.push("payload should be present");
  }
  if (!warnings.length) return;
  emitEvent(runtime.eventListener, "hook_context_schema_warning", {
    point: normalizedPoint,
    warnings,
  });
}
