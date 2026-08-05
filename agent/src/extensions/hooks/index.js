/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { getSystemRuntimeFromRuntime } from "../../context/agent-context-accessor.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import { resolveHookClientEmitter } from "./client-channel.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { isHookRuntimeEventVerboseEnabled } from "@noobot/shared/runtime-events-config";
import {
  HOOK_CANCELLATION_MODE,
  createEmptyHookResult,
  requireHookPointDescriptor,
} from "@noobot/hook-protocol";

const HOOK_PROGRESS_TEXT_LIMIT = LENGTH_THRESHOLDS.display.hookProgressTextChars;
const HOOK_PROGRESS_VERBOSE_ENABLED_VALUES = new Set(["1", "true", "on", "yes", "enable", "enabled"]);
const HOOK_PROGRESS_IMPORTANT_STATUSES = new Set([
  "abort",
  "aborted",
  "block",
  "blocked",
  "error",
  "fail",
  "failed",
  "failure",
  "reject",
  "rejected",
  "timeout",
  "warn",
  "warning",
]);
const HOOK_PROGRESS_IMPORTANT_EVENT_RE = /\b(error|fail|failed|failure|reject|rejected|blocked?|abort|aborted|timeout|warn(?:ing)?)\b/i;
const HOOK_CLIENT_BLOCKED_KEYS = new Set([
  "agent",
  "agentContext",
  "runtime",
  "hookManager",
  "hooks",
  "controllers",
]);
const HOOK_PLUGIN_PROGRESS_ALLOWED_KEYS = new Set([
  "plugin",
  "version",
  "point",
  "stage",
  "status",
  "fsmState",
  "fsmRejected",
  "reason",
  "toolName",
  "commitType",
  "message",
  "timestamp",
  "durationMs",
  "error",
]);

const PLUGIN_CAPABILITY_RESPONSE_ALLOWED_KEYS = new Set([
  "event",
  "category",
  "type",
  "pluginFlow",
  "chain",
  "purpose",
  "domain",
  "model",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "output",
  "text",
  "finishedReason",
  "turn",
  "toolTurnLimitReached",
]);

function resolveRuntimeHookManager(runtime = {}) {
  return runtime?.hookManager && typeof runtime.hookManager.emit === "function"
    ? runtime.hookManager
    : null;
}

export { resolveRuntimeHookManager };

export function resolveHookRuntimeMeta(runtime = {}) {
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  return {
    userId: String(systemRuntime?.userId || runtime?.userId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
    parentSessionId: resolveParentSessionId({ runtime }),
    dialogProcessId: String(runtime?.systemRuntime?.dialogProcessId || "").trim(),
    turnScopeId: String(
      systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || runtime?.turnScopeId || "",
    ).trim(),
    caller: String(systemRuntime?.caller || "").trim(),
  };
}

export function withHookRuntimeMeta(runtime = {}, context = {}) {
  const safeContext = context && typeof context === "object" ? context : {};
  return {
    ...resolveHookRuntimeMeta(runtime),
    ...safeContext,
  };
}

function sanitizeForHookClient(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 6) return "[Truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeForHookClient(item, depth + 1, seen));
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const output = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (HOOK_CLIENT_BLOCKED_KEYS.has(String(key || "").trim())) continue;
    output[key] = sanitizeForHookClient(item, depth + 1, seen);
    count += 1;
    if (count >= 100) break;
  }
  return output;
}

function truncateHookProgressText(value) {
  const text = String(value ?? "");
  return text.length > HOOK_PROGRESS_TEXT_LIMIT
    ? `${text.slice(0, HOOK_PROGRESS_TEXT_LIMIT)}...`
    : text;
}

function isHookPluginProgressTraceEnabled(runtime = {}) {
  const raw = runtime?.systemRuntime?.hookPluginProgressTrace ?? runtime?.hookPluginProgressTrace;
  if (raw === true) return true;
  return HOOK_PROGRESS_VERBOSE_ENABLED_VALUES.has(String(raw ?? "").trim().toLowerCase());
}

function isImportantHookPluginProgress(event = "", data = {}) {
  const name = String(event || "").trim();
  if (HOOK_PROGRESS_IMPORTANT_EVENT_RE.test(name)) return true;
  if (data?.error) return true;
  if (data?.fsmRejected === true) return true;
  const status = String(data?.status || data?.fsmState || "").trim().toLowerCase();
  return HOOK_PROGRESS_IMPORTANT_STATUSES.has(status);
}

function normalizeHookPluginProgressData(data = {}) {
  const input = data && typeof data === "object" ? data : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key || "").trim();
    if (!HOOK_PLUGIN_PROGRESS_ALLOWED_KEYS.has(normalizedKey)) continue;
    if (normalizedKey === "error") {
      const safeError = sanitizeForHookClient(value);
      if (safeError && typeof safeError === "object" && !Array.isArray(safeError)) {
        output.error = {
          name: truncateHookProgressText(safeError?.name || "Error"),
          message: truncateHookProgressText(safeError?.message || ""),
          code: safeError?.code ? String(safeError.code) : undefined,
        };
      } else if (typeof safeError === "string") {
        output.error = { name: "Error", message: truncateHookProgressText(safeError) };
      } else {
        output.error = null;
      }
      continue;
    }
    const safeValue = sanitizeForHookClient(value);
    output[normalizedKey] = ["message", "reason"].includes(normalizedKey)
      ? truncateHookProgressText(safeValue)
      : safeValue;
  }
  return output;
}

function normalizePluginCapabilityResponseData(data = {}) {
  const input = data && typeof data === "object" ? data : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key || "").trim();
    if (!PLUGIN_CAPABILITY_RESPONSE_ALLOWED_KEYS.has(normalizedKey)) continue;
    output[normalizedKey] = sanitizeForHookClient(value);
  }
  return output;
}

function createHookClientEmitter({ listener = null, point = "", runtime = {} } = {}) {
  return (event = "", data = {}) => {
    const name = String(event || "").trim() || "hook_progress";
    if (name === "plugin_capability_response") {
      emitEvent(listener, name, normalizePluginCapabilityResponseData(data));
      return;
    }
    if (!isHookPluginProgressTraceEnabled(runtime) && !isImportantHookPluginProgress(name, data)) {
      return;
    }
    emitEvent(listener, "hook_plugin_progress", {
      point: String(point || "").trim(),
      event: name,
      data: normalizeHookPluginProgressData(data),
    });
  };
}

export { resolveHookClientEmitter };

function withHookClientEmitter(context = {}, emitHookClientEvent = null) {
  const safeContext = context && typeof context === "object" ? context : {};
  if (typeof emitHookClientEvent !== "function") return safeContext;
  safeContext.emitHookClientEvent = emitHookClientEvent;
  return safeContext;
}

export async function runAgentRuntimeHook({
  runtime = {},
  point = "",
  context = {},
  eventListener = null,
} = {}) {
  const descriptor = requireHookPointDescriptor(point);
  const normalizedPoint = descriptor.point;
  const listener = eventListener || runtime?.eventListener || null;
  const manager = resolveRuntimeHookManager(runtime);
  if (!manager) {
    return createEmptyHookResult(normalizedPoint, context);
  }
  const emitHookClientEvent = createHookClientEmitter({
    listener,
    point: normalizedPoint,
    runtime,
  });
  const hookedContext = withHookClientEmitter(context, emitHookClientEvent);
  const verboseHookRuntimeEvents = isHookRuntimeEventVerboseEnabled({ runtime });
  const invocationSignal = descriptor.cancellationMode === HOOK_CANCELLATION_MODE.DETACHED
    ? null
    : runtime?.abortSignal || null;
  const startedAt = Date.now();

  if (verboseHookRuntimeEvents) {
    emitEvent(listener, "hook_start", { point: normalizedPoint });
  }
  try {
    const result = await manager.emit(normalizedPoint, hookedContext, {
      signal: invocationSignal,
    });
    const summary = {
      point: normalizedPoint,
      status: result.failures.length > 0 ? "error" : "ok",
      errorCount: result.failures.length,
      durationMs: Date.now() - startedAt,
    };
    emitEvent(listener, verboseHookRuntimeEvents ? "hook_end" : "hook_summary", summary);
    return {
      ...result,
      context: hookedContext,
    };
  } catch (error) {
    if (invocationSignal?.aborted) throw error;
    emitEvent(listener, "hook_error", {
      point: normalizedPoint,
      message: error?.message || String(error),
    });
    throw error;
  }
}
