/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../event/index.js";

const DEFAULT_HOOK_TIMEOUT_MS = 3000;
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

export const HOOK_POINTS = Object.freeze({
  BEFORE_TURN: "before_turn",
  AFTER_TURN: "after_turn",
  ON_ERROR: "on_error",
  ON_ABORT: "on_abort",
  BEFORE_CONTEXT_BUILD: "before_context_build",
  AFTER_CONTEXT_BUILD: "after_context_build",
  CONTEXT_BUILD_ERROR: "context_build_error",
  BEFORE_LLM_CALL: "before_llm_call",
  AFTER_LLM_CALL: "after_llm_call",
  LLM_CALL_ERROR: "llm_call_error",
  BEFORE_TOOL_CALLS: "before_tool_calls",
  BEFORE_TOOL_CALL: "before_tool_call",
  AFTER_TOOL_CALL: "after_tool_call",
  TOOL_CALL_ERROR: "tool_call_error",
  BEFORE_STATE_COMMIT: "before_state_commit",
  AFTER_STATE_COMMIT: "after_state_commit",
  BEFORE_FINAL_OUTPUT: "before_final_output",
  AFTER_SESSION_DELETE: "after_session_delete",
});

function createHookTimeoutError({ point = "", hookId = "", timeoutMs = 0 } = {}) {
  const err = new Error(`hook timeout: ${point || "unknown"}#${hookId || "anonymous"} (${timeoutMs}ms)`);
  err.code = "HOOK_TIMEOUT";
  err.point = point;
  err.hookId = hookId;
  err.timeoutMs = timeoutMs;
  return err;
}

function withTimeout(promise, timeoutMs, timeoutFactory) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutFactory()), timeoutMs);
    }),
  ]);
}

function resolveHookId(point = "", id = "", index = 0) {
  const normalizedId = String(id || "").trim();
  if (normalizedId) return normalizedId;
  return `${String(point || "hook").trim() || "hook"}_${index + 1}`;
}

function resolveRuntimeHookManager(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return null;
  const runtimeHookManager = runtime.hookManager;
  if (runtimeHookManager && typeof runtimeHookManager === "object") return runtimeHookManager;
  const runtimeHooks = runtime.hooks;
  if (runtimeHooks && typeof runtimeHooks === "object") {
    if (typeof runtimeHooks.emit === "function" || typeof runtimeHooks.run === "function") {
      return runtimeHooks;
    }
    if (runtimeHooks.manager && typeof runtimeHooks.manager === "object") {
      return runtimeHooks.manager;
    }
  }
  return null;
}

export function createHookManager({
  defaultTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS,
  onError = null,
} = {}) {
  const registry = new Map();
  let seq = 0;

  function list(point = "") {
    const normalizedPoint = String(point || "").trim();
    if (normalizedPoint) {
      return Array.isArray(registry.get(normalizedPoint))
        ? registry.get(normalizedPoint).slice()
        : [];
    }
    return Array.from(registry.entries()).map(([name, handlers]) => ({
      point: name,
      handlers: Array.isArray(handlers) ? handlers.slice() : [],
    }));
  }

  function on(point = "", handler = null, options = {}) {
    const normalizedPoint = String(point || "").trim();
    if (!normalizedPoint || typeof handler !== "function") {
      throw new Error("hook point and handler are required");
    }
    const handlers = Array.isArray(registry.get(normalizedPoint))
      ? registry.get(normalizedPoint)
      : [];
    const normalizedTimeoutMs = Number(options?.timeoutMs);
    const item = {
      seq: ++seq,
      id: resolveHookId(normalizedPoint, options?.id, handlers.length),
      point: normalizedPoint,
      handler,
      once: options?.once === true,
      priority: Number.isFinite(Number(options?.priority)) ? Number(options.priority) : 0,
      timeoutMs:
        Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0
          ? normalizedTimeoutMs
          : defaultTimeoutMs,
    };
    handlers.push(item);
    handlers.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.seq - b.seq;
    });
    registry.set(normalizedPoint, handlers);
    return () => off(normalizedPoint, item.id);
  }

  function once(point = "", handler = null, options = {}) {
    return on(point, handler, { ...options, once: true });
  }

  function off(point = "", hookId = "") {
    const normalizedPoint = String(point || "").trim();
    const normalizedId = String(hookId || "").trim();
    if (!normalizedPoint || !normalizedId) return false;
    const handlers = Array.isArray(registry.get(normalizedPoint))
      ? registry.get(normalizedPoint)
      : [];
    const next = handlers.filter((item) => item?.id !== normalizedId);
    if (next.length === handlers.length) return false;
    if (!next.length) registry.delete(normalizedPoint);
    else registry.set(normalizedPoint, next);
    return true;
  }

  function clear(point = "") {
    const normalizedPoint = String(point || "").trim();
    if (!normalizedPoint) {
      registry.clear();
      return;
    }
    registry.delete(normalizedPoint);
  }

  async function runSingleHook({ item = {}, point = "", context = {} }) {
    const timeoutMs = Number(item?.timeoutMs);
    const startedAt = Date.now();
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => item.handler(context)),
        timeoutMs,
        () =>
          createHookTimeoutError({
            point,
            hookId: item.id,
            timeoutMs,
          }),
      );
      return {
        ok: true,
        id: item.id,
        point,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        result,
      };
    } catch (error) {
      if (typeof onError === "function") {
        try {
          onError({ error, point, hookId: item.id, context });
        } catch {}
      }
      return {
        ok: false,
        id: item.id,
        point,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        error,
      };
    }
  }

  async function emit(point = "", context = {}, { parallel = false } = {}) {
    const normalizedPoint = String(point || "").trim();
    if (!normalizedPoint) {
      return { point: normalizedPoint, context, results: [], errors: [] };
    }
    const handlers = Array.isArray(registry.get(normalizedPoint))
      ? registry.get(normalizedPoint).slice()
      : [];
    if (!handlers.length) {
      return { point: normalizedPoint, context, results: [], errors: [] };
    }

    const results = [];
    if (parallel) {
      const settled = await Promise.all(
        handlers.map((item) => runSingleHook({ item, point: normalizedPoint, context })),
      );
      results.push(...settled);
    } else {
      for (const item of handlers) {
        const result = await runSingleHook({
          item,
          point: normalizedPoint,
          context,
        });
        results.push(result);
      }
    }

    for (const item of handlers) {
      if (!item?.once) continue;
      off(normalizedPoint, item.id);
    }

    return {
      point: normalizedPoint,
      context,
      results,
      errors: results.filter((item) => item?.ok === false),
    };
  }

  return {
    on,
    once,
    off,
    clear,
    list,
    emit,
    run: emit,
  };
}

export { resolveRuntimeHookManager };

export function resolveHookRuntimeMeta(runtime = {}) {
  const systemRuntime =
    runtime?.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : {};
  return {
    userId: String(systemRuntime?.userId || runtime?.userId || "").trim(),
    sessionId: String(systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
    parentSessionId: String(systemRuntime?.parentSessionId || "").trim(),
    dialogProcessId: String(systemRuntime?.dialogProcessId || "").trim(),
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
          name: String(safeError?.name || "Error"),
          message: String(safeError?.message || ""),
          code: safeError?.code ? String(safeError.code) : undefined,
        };
      } else if (typeof safeError === "string") {
        output.error = { name: "Error", message: safeError };
      } else {
        output.error = null;
      }
      continue;
    }
    output[normalizedKey] = sanitizeForHookClient(value);
  }
  return output;
}

function createHookClientChannel({ listener = null, point = "" } = {}) {
  return {
    emit(event = "", data = {}) {
      const name = String(event || "").trim() || "hook_progress";
      emitEvent(listener, "hook_plugin_progress", {
        point: String(point || "").trim(),
        event: name,
        data: normalizeHookPluginProgressData(data),
      });
    },
  };
}

function withHookClientChannel(context = {}, channel = null) {
  const safeContext = context && typeof context === "object" ? context : {};
  if (!channel || typeof channel.emit !== "function") return safeContext;
  safeContext.hookClientChannel = channel;
  safeContext.emitHookClientEvent = (event = "", data = {}) => channel.emit(event, data);
  return safeContext;
}

export async function runRuntimeHook({
  runtime = {},
  point = "",
  context = {},
  parallel = false,
  eventListener = null,
} = {}) {
  const normalizedPoint = String(point || "").trim();
  if (!normalizedPoint) {
    return { executed: false, point: normalizedPoint, context, results: [], errors: [] };
  }
  const listener = eventListener || runtime?.eventListener || null;
  const manager = resolveRuntimeHookManager(runtime);
  if (!manager) {
    return { executed: false, point: normalizedPoint, context, results: [], errors: [] };
  }
  const hookClientChannel = createHookClientChannel({
    listener,
    point: normalizedPoint,
  });
  const hookedContext = withHookClientChannel(context, hookClientChannel);

  emitEvent(listener, "hook_start", { point: normalizedPoint });
  try {
    const runner =
      typeof manager.emit === "function"
        ? manager.emit.bind(manager)
        : typeof manager.run === "function"
          ? manager.run.bind(manager)
          : null;
    if (!runner) {
      return { executed: false, point: normalizedPoint, context: hookedContext, results: [], errors: [] };
    }
    const result = await runner(normalizedPoint, hookedContext, { parallel });
    emitEvent(listener, "hook_end", {
      point: normalizedPoint,
      errorCount: Array.isArray(result?.errors) ? result.errors.length : 0,
    });
    return {
      executed: true,
      ...(result && typeof result === "object" ? result : {}),
      point: normalizedPoint,
      context: hookedContext,
    };
  } catch (error) {
    emitEvent(listener, "hook_error", {
      point: normalizedPoint,
      message: error?.message || String(error),
    });
    return {
      executed: true,
      point: normalizedPoint,
      context: hookedContext,
      results: [],
      errors: [error],
    };
  }
}
