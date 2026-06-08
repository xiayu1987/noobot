/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../event/index.js";
import { createAgentHookManager } from "../../hook/index.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";

export const BOT_HOOK_POINTS = Object.freeze({
  BEFORE_SESSION_RUN: "before_session_run",
  BEFORE_AGENT_DISPATCH: "before_agent_dispatch",
  AFTER_AGENT_DISPATCH: "after_agent_dispatch",
  AGENT_DISPATCH_ERROR: "agent_dispatch_error",
  AFTER_SESSION_RUN: "after_session_run",
  SESSION_RUN_ERROR: "session_run_error",
});

export function createBotHookManager(options = {}) {
  return createAgentHookManager(options);
}

function resolveBotRuntimeHookManager(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return null;
  const manager = runtime.botHookManager;
  if (manager && typeof manager === "object") return manager;
  const hooks = runtime.botHooks;
  if (hooks && typeof hooks === "object") {
    if (typeof hooks.emit === "function" || typeof hooks.run === "function") {
      return hooks;
    }
    if (hooks.manager && typeof hooks.manager === "object") {
      return hooks.manager;
    }
  }
  return null;
}

export { resolveBotRuntimeHookManager };

export function resolveBotHookRuntimeMeta({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  caller = "",
} = {}) {
  return {
    userId: String(userId || "").trim(),
    sessionId: String(sessionId || "").trim(),
    parentSessionId: normalizeParentSessionId(parentSessionId),
    dialogProcessId: resolveDialogProcessIdFromContext({ dialogProcessId }),
    caller: String(caller || "").trim(),
  };
}

export function withBotHookRuntimeMeta(meta = {}, context = {}) {
  const safeContext = context && typeof context === "object" ? context : {};
  return {
    ...resolveBotHookRuntimeMeta(meta),
    ...safeContext,
  };
}

export async function runBotRuntimeHook({
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
  const manager = resolveBotRuntimeHookManager(runtime);
  if (!manager) {
    return { executed: false, point: normalizedPoint, context, results: [], errors: [] };
  }
  const listener = eventListener || runtime?.eventListener || null;
  emitEvent(listener, "bot_hook_start", { point: normalizedPoint });
  try {
    const runner =
      typeof manager.emit === "function"
        ? manager.emit.bind(manager)
        : typeof manager.run === "function"
          ? manager.run.bind(manager)
          : null;
    if (!runner) {
      return { executed: false, point: normalizedPoint, context, results: [], errors: [] };
    }
    const result = await runner(normalizedPoint, context, { parallel });
    emitEvent(listener, "bot_hook_end", {
      point: normalizedPoint,
      errorCount: Array.isArray(result?.errors) ? result.errors.length : 0,
    });
    return {
      executed: true,
      ...(result && typeof result === "object" ? result : {}),
      point: normalizedPoint,
      context,
    };
  } catch (error) {
    emitEvent(listener, "bot_hook_error", {
      point: normalizedPoint,
      message: error?.message || String(error),
    });
    return {
      executed: true,
      point: normalizedPoint,
      context,
      results: [],
      errors: [error],
    };
  }
}
