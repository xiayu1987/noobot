/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  TURN_EVENT,
  TURN_ORPHAN_RECOVERY,
  TURN_PHASE,
  TURN_RECOVERY_ACTION,
  TURN_STATE,
  requireTurnExecutionObservation,
  requireTurnRecoveryCommitResult,
} from "@noobot/session-protocol/turn-lifecycle";
import { text as clean } from "@noobot/shared/value";
import { assertTurnRecord } from "@noobot/session-protocol";

const RECOVERABLE_FINALIZE_STATES = new Set([
  TURN_STATE.COMPLETION_REQUESTING,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOPPING,
  TURN_STATE.STOP_FAILED,
]);
const none = (reason) => ({ action: TURN_RECOVERY_ACTION.NONE, reason });

function hasRecoverableFinalize(turn) {
  return (
    turn?.finalizeIntent?.retryable === true && RECOVERABLE_FINALIZE_STATES.has(clean(turn.state))
  );
}

export function assessTurnRecovery({
  turn = null,
  observation = null,
  graceMs = TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs,
} = {}) {
  if (turn === null) return none("no_active_turn");
  assertTurnRecord(turn);
  if (hasRecoverableFinalize(turn)) {
    return { action: TURN_RECOVERY_ACTION.FINALIZE, reason: "finalize_intent_pending" };
  }
  if (observation === null) return none("execution_liveness_unavailable");
  requireTurnExecutionObservation(observation);
  if (observation.alive) return none("execution_alive");
  const updatedAtMs = Date.parse(clean(turn.updatedAt));
  const observedAtMs = observation.observedAtMs;
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(observedAtMs)) {
    return none("invalid_recovery_time");
  }
  if (observedAtMs - updatedAtMs < Number(graceMs)) return none("orphan_grace_period");
  return { action: TURN_RECOVERY_ACTION.ORPHAN, reason: "execution_lost" };
}

export async function inspectTurnRecovery({
  turn = null,
  identity = {},
  inspectExecution,
  graceMs,
} = {}) {
  if (turn !== null) assertTurnRecord(turn);
  if (!turn || hasRecoverableFinalize(turn)) return assessTurnRecovery({ turn, graceMs });
  const observation =
    typeof inspectExecution === "function"
      ? await inspectExecution({
          ...identity,
          turnScopeId: clean(turn.turnScopeId),
          dialogProcessId: clean(turn.dialogProcessId),
          executionId: clean(turn.executionId),
        })
      : null;
  return assessTurnRecovery({ turn, observation, graceMs });
}

function finalizeCommand(turn, identity) {
  const intent = turn.finalizeIntent;
  const isStop = clean(intent.type) === "stop";
  const completionCommitId = clean(intent.commandId);
  return {
    ...identity,
    turnScopeId: clean(turn.turnScopeId),
    dialogProcessId: clean(turn.dialogProcessId),
    commandId: completionCommitId,
    causationId: completionCommitId,
    eventType: isStop ? TURN_EVENT.STOP_COMPLETED : TURN_EVENT.COMPLETED,
    phase: isStop ? TURN_PHASE.STOP : TURN_PHASE.COMPLETION,
    expectedRevision: turn.revision,
    terminalStatus: { command: isStop ? "user_stopped" : "completed" },
  };
}

function orphanCommand(turn, identity) {
  const turnScopeId = clean(turn.turnScopeId);
  const phase = turn.phase;
  const commandId = `orphaned:${turnScopeId}:failed:${phase}:r${turn.revision}`;
  return {
    ...identity,
    turnScopeId,
    dialogProcessId: clean(turn.dialogProcessId),
    commandId,
    causationId: commandId,
    eventType: TURN_EVENT.FAILED,
    phase,
    expectedRevision: turn.revision,
    failure: { ...TURN_ORPHAN_RECOVERY.failure },
    terminalStatus: {
      command: TURN_ORPHAN_RECOVERY.terminalCommand,
      description: TURN_ORPHAN_RECOVERY.failure.message,
    },
  };
}

export async function recoverActiveTurn({
  turn = null,
  identity = {},
  inspectExecution,
  commitTurnLifecycle,
  graceMs,
} = {}) {
  const assessment = await inspectTurnRecovery({ turn, identity, inspectExecution, graceMs });
  if (assessment.action === TURN_RECOVERY_ACTION.NONE) {
    return { recovered: false, action: assessment.action, reason: assessment.reason };
  }
  if (typeof commitTurnLifecycle !== "function") {
    return { recovered: false, action: assessment.action, reason: "lifecycle_commit_unavailable" };
  }
  const command =
    assessment.action === TURN_RECOVERY_ACTION.FINALIZE
      ? finalizeCommand(turn, identity)
      : orphanCommand(turn, identity);
  const committed = requireTurnRecoveryCommitResult(await commitTurnLifecycle(command));
  if (committed.applied || committed.deduplicated === true) {
    return { recovered: true, action: assessment.action, committed };
  }
  return {
    recovered: false,
    action: assessment.action,
    reason: committed.reason,
    committed,
  };
}
