/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import {
  TURN_EVENT,
  TURN_PHASE,
  TURN_RECOVERY_ACTION,
  TURN_STATE,
} from "@noobot/session-protocol/turn-lifecycle";

const RECOVERABLE_FINALIZE_STATES = new Set([
  TURN_STATE.COMPLETION_REQUESTING,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOPPING,
  TURN_STATE.STOP_FAILED,
]);
const PHASES = new Set(Object.values(TURN_PHASE));
const clean = (value) => String(value || "").trim();
const none = (reason) => ({ action: TURN_RECOVERY_ACTION.NONE, reason });

function hasRecoverableFinalize(turn) {
  return (
    turn?.finalizeIntent?.retryable === true && RECOVERABLE_FINALIZE_STATES.has(clean(turn.state))
  );
}

export function assessTurnRecovery({
  turn = null,
  observation = null,
  now = () => Date.now(),
  graceMs = TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs,
} = {}) {
  if (!turn || !clean(turn.turnScopeId)) return none("no_active_turn");
  if (hasRecoverableFinalize(turn)) {
    return { action: TURN_RECOVERY_ACTION.FINALIZE, reason: "finalize_intent_pending" };
  }
  if (!observation) return none("execution_liveness_unavailable");
  if (observation === true || observation.alive === true) return none("execution_alive");
  const updatedAtMs = Date.parse(clean(turn.updatedAt));
  const observedAtMs = Number(observation.observedAtMs ?? now());
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
  now,
  graceMs,
} = {}) {
  if (!turn || hasRecoverableFinalize(turn)) return assessTurnRecovery({ turn, now, graceMs });
  const observation =
    typeof inspectExecution === "function"
      ? await inspectExecution({
          ...identity,
          turnScopeId: clean(turn.turnScopeId),
          dialogProcessId: clean(turn.dialogProcessId),
          executionId: clean(turn.executionId),
        })
      : null;
  return assessTurnRecovery({ turn, observation, now, graceMs });
}

function finalizeCommand(turn, identity) {
  const intent = turn.finalizeIntent;
  const isStop = clean(intent.type) === "stop";
  const completionCommitId = clean(intent.commandId || `finalize:${turn.turnScopeId}`);
  return {
    ...identity,
    turnScopeId: clean(turn.turnScopeId),
    dialogProcessId: clean(turn.dialogProcessId),
    commandId: completionCommitId,
    eventType: isStop ? TURN_EVENT.STOP_COMPLETED : TURN_EVENT.COMPLETED,
    phase: isStop ? TURN_PHASE.STOP : TURN_PHASE.COMPLETION,
    expectedRevision: Number(turn.revision || 0),
    completionCommitId,
    terminalStatus: {
      command: isStop ? "user_stopped" : "completed",
      ...(isStop && intent.payload?.assistantMessage
        ? { assistantMessage: intent.payload.assistantMessage }
        : {}),
    },
  };
}

function orphanCommand(turn, identity) {
  const turnScopeId = clean(turn.turnScopeId);
  const phase = PHASES.has(turn.phase) ? turn.phase : TURN_PHASE.PROCESSING;
  return {
    ...identity,
    turnScopeId,
    dialogProcessId: clean(turn.dialogProcessId),
    commandId: `orphaned:${turnScopeId}:failed:${phase}:r${Number(turn.revision || 0)}`,
    eventType: TURN_EVENT.FAILED,
    phase,
    expectedRevision: Number(turn.revision || 0),
    failure: {
      phase,
      code: "service_restart_orphaned_turn",
      message: "active turn execution was lost after service restart",
      retryable: false,
    },
  };
}

export async function recoverActiveTurn({
  turn = null,
  identity = {},
  inspectExecution,
  commitTurnLifecycle,
  now,
  graceMs,
} = {}) {
  const assessment = await inspectTurnRecovery({ turn, identity, inspectExecution, now, graceMs });
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
  const committed = await commitTurnLifecycle(command);
  if (committed?.applied === true || committed?.deduplicated === true) {
    return { recovered: true, action: assessment.action, committed };
  }
  return {
    recovered: false,
    action: assessment.action,
    reason: committed?.reason || `${assessment.action}_commit_failed`,
    committed,
  };
}
