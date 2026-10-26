/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import {
  assertOptionalHookManager,
  createEmptyHookResult,
  HOOK_CANCELLATION_MODE,
  requireHookPointDescriptor,
} from "@noobot/hook-protocol";

export async function runBotRuntimeHook({ runtime, point, context = {} }) {
  const descriptor = requireHookPointDescriptor(point);
  const normalizedPoint = descriptor.point;
  const manager = assertOptionalHookManager(runtime.botHookManager, "botHookManager");
  if (manager === null) {
    return createEmptyHookResult(normalizedPoint, context);
  }
  const listener = runtime.eventListener;
  const invocationSignal =
    descriptor.cancellationMode === HOOK_CANCELLATION_MODE.DETACHED ? null : runtime.abortSignal;
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
