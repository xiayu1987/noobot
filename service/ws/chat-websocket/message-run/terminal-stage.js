/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TURN_EVENT,
  TURN_PHASE,
  createTurnLifecycleCommandId,
  createTurnLifecycleRejectedError,
} from "@noobot/session-protocol";
import { isUserStopRunAbort } from "../stop-lifecycle.js";

export async function finalizeRunResult(context, run, accepted) {
  if (context.state.currentRunTimedOut && context.state.currentAbortSignal?.aborted) {
    await context.finalizeTimeout(context.buildRunStateSnapshot());
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
    throw createTurnLifecycleRejectedError(processed);
  }
  context.lifecycle.latestTurn = processed.turn;
  await context.finalizeCompleted(context.buildRunStateSnapshot(), {
    commandId: accepted.commandId,
  });
}
