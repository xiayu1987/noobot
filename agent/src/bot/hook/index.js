import { normalizeDialogProcessId, normalizeParentSessionId } from "@noobot/session-protocol";
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import {
  createEmptyHookResult,
  HOOK_CANCELLATION_MODE,
  requireHookPointDescriptor,
} from "@noobot/hook-protocol";

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
    dialogProcessId: normalizeDialogProcessId(dialogProcessId),
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
  const descriptor = requireHookPointDescriptor(point);
  const normalizedPoint = descriptor.point;
  const manager = resolveBotRuntimeHookManager(runtime);
  if (!manager) {
    return createEmptyHookResult(normalizedPoint, context);
  }
  const listener = eventListener || runtime?.eventListener || null;
  const invocationSignal =
    descriptor.cancellationMode === HOOK_CANCELLATION_MODE.DETACHED
      ? null
      : runtime?.abortSignal || null;
  emitEvent(listener, "bot_hook_start", { point: normalizedPoint });
  try {
    const result = await manager.emit(normalizedPoint, context, {
      signal: invocationSignal,
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
    if (invocationSignal?.aborted) throw error;
    emitEvent(listener, "bot_hook_error", {
      point: normalizedPoint,
      message: error?.message || String(error),
    });
    throw error;
  }
}
