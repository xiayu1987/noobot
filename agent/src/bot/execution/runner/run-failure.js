/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "noobot-i18n/agent/system-text";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { runBotRuntimeHook, withBotHookRuntimeMeta } from "../../hook/index.js";
import {
  BOT_MANAGE_LOG_EVENT,
  BOT_MANAGE_LOG_SOURCE,
  SESSION_ASYNC_STATUS,
} from "../../config/constants.js";
import {
  isAbortError,
  isUserStopAbort,
} from "../../../shared/utils/error-utils.js";
import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";
import { syncLifecycleRuntimeState } from "../../../runtime/lifecycle/state-machine.js";

export async function handleSessionRunFailure({
  error,
  abortSignal,
  lifecycle,
  lifecycleRuntime,
  persistStoppedSnapshotFromRuntime,
  resolvedRuntimeEventListener,
  resolvedRunConfig,
  resolvedUsedSessionId,
  resolvedDialogProcessId,
  resolvedParentAsyncResultContainer,
  upsertParentAsyncTask,
  errorLogger,
  now,
  userId,
  sessionId,
  parentSessionId,
  caller,
  message,
}) {
  const aborted = isAbortError(error, abortSignal);
  const userStopped = aborted && isUserStopAbort(error, abortSignal);
  if (aborted) {
    if (userStopped) {
      await lifecycleRuntime?.persistCurrentTurnMessages?.();
      const stoppedSnapshotPersistence =
        await persistStoppedSnapshotFromRuntime("runner_user_stop_catch");
      await lifecycle?.userStop?.({
        reason: tSystem("ws.dialogStoppedByUser"),
        stoppedSnapshotPersistence,
      });
      await lifecycleRuntime?.persistCurrentTurnMessages?.();
    } else {
      const interruptionReason = resolveExecutionAbortMessage({ error, abortSignal });
      lifecycle?.interrupt?.({
        reason: interruptionReason,
        stopType: resolveExecutionAbortType({ error, abortSignal }),
        stoppedSnapshotPersistence: {
          status: "skipped",
          reason: "non_user_abort",
          source: "runner_abort_catch",
          messageCount: 0,
          systemCount: 0,
          historyCount: 0,
          incrementalCount: 0,
        },
      });
    }
  } else {
    lifecycle?.fail?.({ error });
  }
  syncLifecycleRuntimeState(lifecycleRuntime, lifecycle);
  if (error && typeof error === "object" && lifecycle?.snapshot) {
    error.lifecycle = lifecycle.snapshot;
  }
  await runBotRuntimeHook({
    runtime: {
      eventListener: resolvedRuntimeEventListener,
      botHookManager:
        resolvedRunConfig?.botHookManager &&
        typeof resolvedRunConfig.botHookManager === "object"
          ? resolvedRunConfig.botHookManager
          : null,
      abortSignal: resolvedRunConfig?.abortSignal || null,
    },
    point: HOOK_POINT.BOT.SESSION_RUN_ERROR,
    context: withBotHookRuntimeMeta(
      {
        userId,
        sessionId: resolvedUsedSessionId,
        parentSessionId,
        dialogProcessId: resolvedDialogProcessId,
        caller,
      },
      { message, runConfig: resolvedRunConfig, error },
    ),
    eventListener: resolvedRuntimeEventListener,
  });
  upsertParentAsyncTask({
    parentAsyncResultContainer: resolvedParentAsyncResultContainer,
    sessionId,
    parentSessionId,
    patch: {
      status: userStopped
        ? SESSION_ASYNC_STATUS.USER_STOPPED
        : SESSION_ASYNC_STATUS.FAILED,
      endedAt: now(),
      error:
        userStopped
          ? tSystem("ws.dialogStoppedByUser")
          : aborted
            ? resolveExecutionAbortMessage({ error, abortSignal })
            : error?.message || String(error),
      result: null,
    },
  });
  if (!aborted) {
    await errorLogger.log({
      userId,
      sessionId,
      parentSessionId,
      source: BOT_MANAGE_LOG_SOURCE.RUN_SESSION,
      event: BOT_MANAGE_LOG_EVENT.RUN_SESSION_FAILED,
      error,
    });
  }
  throw error;
}
