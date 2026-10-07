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
import { isAbortError, isUserStopAbort } from "../../../shared/utils/error-utils.js";
import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";
import { syncLifecycleRuntimeState } from "../../../runtime/lifecycle/state-machine.js";
import { createExecutionFailure } from "../../../shared/errors/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import {
  buildExecutionReport,
  EXECUTION_REPORT_STATUS,
  saveExecutionReportBestEffort,
} from "../../../observability/execution-log/execution-report.js";
import { summarizeExecutionLogs } from "../../../observability/execution-log/execution-log-summary.js";

function resolveFailureReportStatus(error, abortSignal) {
  if (!isAbortError(error, abortSignal)) return EXECUTION_REPORT_STATUS.FAILED;
  return isUserStopAbort(error, abortSignal)
    ? EXECUTION_REPORT_STATUS.USER_STOPPED
    : EXECUTION_REPORT_STATUS.INTERRUPTED;
}

async function loadFailureSummary(context, sessionId) {
  if (typeof context.getExecutionBundle !== "function") return null;
  const execution = await runBestEffort(
    () =>
      context.getExecutionBundle({
        userId: context.userId,
        sessionId,
        parentSessionId: context.parentSessionId,
        persistenceContext: context.persistenceContext,
      }),
    { operationName: "executionReport.loadFailureLogs", context: { sessionId } },
  );
  if (!Array.isArray(execution?.logs)) return null;
  return summarizeExecutionLogs(execution.logs, {
    dialogProcessId: context.resolvedDialogProcessId,
  });
}

async function saveFailureReport(context, failure) {
  const sessionId = context.resolvedUsedSessionId || context.sessionId;
  if (typeof context.saveExecutionReport !== "function") return;
  const executionSummary = await loadFailureSummary(context, sessionId);
  await saveExecutionReportBestEffort(
    context.saveExecutionReport,
    {
      userId: context.userId,
      sessionId,
      parentSessionId: context.parentSessionId,
      persistenceContext: context.persistenceContext,
      report: buildExecutionReport({
        status: resolveFailureReportStatus(context.error, context.abortSignal),
        sessionId,
        parentSessionId: context.parentSessionId,
        dialogProcessId: context.resolvedDialogProcessId,
        turnScopeId: context.turnScopeId || context.resolvedRunConfig?.turnScopeId,
        caller: context.caller,
        startedAt: context.resolvedRunConfig?.thinkingStartedAt,
        finishedAt: context.now?.(),
        executionSummary,
        error: failure,
      }),
    },
    runBestEffort,
  );
}

async function recordSessionRunFailure({
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
      await lifecycleRuntime?.consumeUserInterjections?.();
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
  const executionFailure = createExecutionFailure(error, lifecycle?.snapshot || null);
  await runBotRuntimeHook({
    runtime: {
      eventListener: resolvedRuntimeEventListener,
      botHookManager:
        resolvedRunConfig?.botHookManager && typeof resolvedRunConfig.botHookManager === "object"
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
      { message, runConfig: resolvedRunConfig, error: executionFailure },
    ),
    eventListener: resolvedRuntimeEventListener,
  });
  upsertParentAsyncTask({
    parentAsyncResultContainer: resolvedParentAsyncResultContainer,
    sessionId,
    parentSessionId,
    patch: {
      status: userStopped ? SESSION_ASYNC_STATUS.USER_STOPPED : SESSION_ASYNC_STATUS.FAILED,
      endedAt: now(),
      error: userStopped
        ? tSystem("ws.dialogStoppedByUser")
        : aborted
          ? resolveExecutionAbortMessage({ error, abortSignal })
          : executionFailure.message,
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
      error: executionFailure,
    });
  }
  return executionFailure;
}

export async function handleSessionRunFailure({ executionEventListener, ...context }) {
  let failure;
  try {
    failure = await recordSessionRunFailure(context);
  } catch (error) {
    failure = createExecutionFailure(
      new AggregateError([context.error, error], error.message, { cause: context.error }),
      context.lifecycle?.snapshot || null,
    );
  }
  let flushError = null;
  try {
    await executionEventListener?.flush();
  } catch (error) {
    flushError = error;
  }
  await saveFailureReport(context, failure);
  if (flushError) {
    throw createExecutionFailure(
      new AggregateError([failure, flushError], failure.message, { cause: failure }),
      context.lifecycle?.snapshot || null,
    );
  }
  throw failure;
}
