/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "noobot-i18n/agent/system-text";
import { isPlainObject } from "@noobot/shared/value";
import { HOOK_POINT, withHookRuntimeIdentity } from "@noobot/hook-protocol";
import { runBotRuntimeHook } from "../../hook/index.js";
import { BOT_MANAGE_LOG_EVENT, BOT_MANAGE_LOG_SOURCE } from "../../config/constants.js";
import { isAbortError, isUserStopAbort } from "../../../shared/utils/error-utils.js";
import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";
import { syncLifecycleRuntimeState } from "../../../runtime/lifecycle/state-machine.js";
import { createExecutionFailure } from "../../../shared/errors/index.js";
import {
  buildExecutionReport,
  EXECUTION_REPORT_STATUS,
} from "@noobot/session-protocol/execution-report";
import { summarizeExecutionLogs } from "../../../observability/execution-log/execution-log-summary.js";
import { materializeStoppedAssistantDraft } from "../../../runtime/tool-execution/stopped-assistant-draft.js";

function resolveFailureReportStatus(error, abortSignal) {
  if (!isAbortError(error, abortSignal)) return EXECUTION_REPORT_STATUS.FAILED;
  return isUserStopAbort(error, abortSignal)
    ? EXECUTION_REPORT_STATUS.USER_STOPPED
    : EXECUTION_REPORT_STATUS.INTERRUPTED;
}

async function readFailureSummary(context, persistence, dialogProcessId) {
  try {
    const logs = await context.getExecutionTurnLogs({ ...persistence, dialogProcessId });
    return { executionSummary: summarizeExecutionLogs(logs), summaryError: null };
  } catch (summaryError) {
    return { executionSummary: null, summaryError };
  }
}

async function saveFailureReport(context, failure) {
  if (context.initializedSession === null) return;
  const { sessionId, dialogProcessId } = context.initializedSession;
  const persistence = {
    userId: context.userId,
    sessionId,
    persistenceScope: context.persistenceScope,
  };
  const { executionSummary, summaryError } = await readFailureSummary(
    context,
    persistence,
    dialogProcessId,
  );
  await context.saveExecutionReport({
    ...persistence,
    report: buildExecutionReport({
      status: resolveFailureReportStatus(context.error, context.abortSignal),
      sessionId,
      parentSessionId: context.parentSessionId,
      dialogProcessId,
      turnScopeId: context.turnScopeId,
      caller: context.caller,
      startedAt: context.resolvedRunConfig?.thinkingStartedAt,
      finishedAt: context.now(),
      executionSummary,
      summaryError,
      error: failure,
    }),
  });
}

async function recordSessionRunFailure({
  error,
  abortSignal,
  lifecycle,
  lifecycleRuntime,
  persistStoppedSnapshotFromRuntime,
  resolvedRuntimeEventListener,
  resolvedRunConfig,
  preparedBotHook,
  errorLogger,
  userId,
  sessionId,
  parentSessionId,
  message,
}) {
  const aborted = isAbortError(error, abortSignal);
  const userStopped = aborted && isUserStopAbort(error, abortSignal);
  if (aborted) {
    if (userStopped) {
      if (lifecycleRuntime) {
        await lifecycleRuntime.consumeUserInterjections();
        await materializeStoppedAssistantDraft(lifecycleRuntime);
        await lifecycleRuntime.persistCurrentTurnMessages();
      }
      const stoppedSnapshotPersistence =
        await persistStoppedSnapshotFromRuntime("runner_user_stop_catch");
      await lifecycle?.userStop({
        reason: tSystem("ws.dialogStoppedByUser"),
        stoppedSnapshotPersistence,
      });
      if (lifecycleRuntime) await lifecycleRuntime.persistCurrentTurnMessages();
    } else {
      const interruptionReason = resolveExecutionAbortMessage({ error, abortSignal });
      lifecycle?.interrupt({
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
    lifecycle?.fail({ error });
  }
  syncLifecycleRuntimeState(lifecycleRuntime, lifecycle);
  const executionFailure = createExecutionFailure(error, lifecycle?.snapshot || null);

  if (preparedBotHook !== null) {
    await runBotRuntimeHook({
      runtime: {
        eventListener: resolvedRuntimeEventListener,
        botHookManager: preparedBotHook.manager,
        abortSignal,
      },
      point: HOOK_POINT.BOT.SESSION_RUN_ERROR,
      context: withHookRuntimeIdentity(preparedBotHook.identity, {
        message,
        runConfig: resolvedRunConfig,
        error: executionFailure,
      }),
    });
  }
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

function assertFailureInitializationState({ preparedBotHook, initializedSession }) {
  if (preparedBotHook !== null && !(isPlainObject(preparedBotHook) && preparedBotHook.identity)) {
    throw new TypeError(
      "handleSessionRunFailure preparedBotHook must be null or { manager, identity }",
    );
  }
  if (
    initializedSession !== null &&
    !(
      isPlainObject(initializedSession) &&
      initializedSession.sessionId &&
      initializedSession.dialogProcessId
    )
  ) {
    throw new TypeError(
      "handleSessionRunFailure initializedSession must be null or { sessionId, dialogProcessId }",
    );
  }
}

export async function handleSessionRunFailure({ executionEventListener, ...context }) {
  assertFailureInitializationState(context);
  let failure;
  try {
    failure = await recordSessionRunFailure(context);
  } catch (error) {
    failure = createExecutionFailure(
      new AggregateError([context.error, error], error.message, { cause: context.error }),
      context.lifecycle?.snapshot || null,
    );
  }
  const followUpErrors = [];
  try {
    await executionEventListener?.flush();
  } catch (error) {
    followUpErrors.push(error);
  }
  try {
    await saveFailureReport(context, failure);
  } catch (error) {
    followUpErrors.push(error);
  }
  if (followUpErrors.length) {
    throw createExecutionFailure(
      new AggregateError([failure, ...followUpErrors], failure.message, { cause: failure }),
      context.lifecycle?.snapshot || null,
    );
  }
  throw failure;
}
