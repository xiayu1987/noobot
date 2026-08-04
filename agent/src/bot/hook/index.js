/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { resolveDialogProcessIdFromContext } from "../../context/session/dialog-process-id-resolver.js";
import { normalizeParentSessionId } from "../../context/parent-session-id-resolver.js";
import { createEmptyHookResult, requireHookPointDescriptor } from "@noobot/hook-protocol";

function resolveBotRuntimeHookManager(runtime = {}) {
  return runtime?.botHookManager && typeof runtime.botHookManager.emit === "function"
    ? runtime.botHookManager
    : null;
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
  eventListener = null,
} = {}) {
  const normalizedPoint = requireHookPointDescriptor(point).point;
  const manager = resolveBotRuntimeHookManager(runtime);
  if (!manager) {
    return createEmptyHookResult(normalizedPoint, context);
  }
  const listener = eventListener || runtime?.eventListener || null;
  emitEvent(listener, "bot_hook_start", { point: normalizedPoint });
  try {
    const result = await manager.emit(normalizedPoint, context, {
      signal: runtime?.abortSignal || null,
    });
    emitEvent(listener, "bot_hook_end", {
      point: normalizedPoint,
      errorCount: result.failures.length,
    });
    return {
      ...result,
      context,
    };
  } catch (error) {
    emitEvent(listener, "bot_hook_error", {
      point: normalizedPoint,
      message: error?.message || String(error),
    });
    throw error;
  }
}
