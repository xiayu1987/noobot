/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EXECUTION_ABORT_TYPE,
  TURN_EVENT,
  TURN_PHASE,
  createTurnLifecycleCommandId,
  createTurnLifecycleRejectedError,
  resolveExecutionAbortMessage,
} from "@noobot/session-protocol";
import { isUserStopRunAbort } from "../stop-lifecycle.js";

export async function finalizeRunResult(context, run, accepted, active) {
  if (context.state.currentRunTimedOut && context.state.currentAbortSignal?.aborted) {
    const timeoutMessage = resolveExecutionAbortMessage({
      abortSignal: context.state.currentAbortSignal,
      fallback: `run timeout after ${active.runTimeoutMs}ms`,
    });
    await context.finalizeTimeout(context.buildRunStateSnapshot(), {
      description: timeoutMessage,
      errorObject: { message: timeoutMessage, code: EXECUTION_ABORT_TYPE.RUN_TIMEOUT },
    });
    return;
  }
  if (isUserStopRunAbort(context.state.currentAbortSignal)) {
    await context.finalizeUserStopped(context.buildRunStateSnapshot());
    return;
  }
  const processed = await context.commitTurnLifecycle({
    userId: run.userId,
    sessionId: run.sessionId,
    turnScopeId: run.turnScopeId,
    dialogProcessId: run.dialogProcessId,
    commandId: createTurnLifecycleCommandId({
      commandId: accepted.commandId,
      eventType: TURN_EVENT.PROCESSING_COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    }),
    causationId: accepted.commandId,
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    phase: TURN_PHASE.COMPLETION,
    completionCommitId: createTurnLifecycleCommandId({
      commandId: accepted.commandId,
      eventType: TURN_EVENT.COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    }),
  });
  if (!processed.applied && !processed.deduplicated) {
    throw createTurnLifecycleRejectedError(processed.reason);
  }
  context.lifecycle.latestTurn = processed.turn;
  await context.finalizeCompleted(context.buildRunStateSnapshot(), {
    commandId: accepted.commandId,
  });
}
