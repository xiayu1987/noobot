/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "../contracts/turn-lifecycle-protocol.mjs";

const RECOVERABLE_FINALIZE_STATES = new Set([
  TURN_STATE.COMPLETION_REQUESTING,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOPPING,
  TURN_STATE.STOP_FAILED,
]);
const PHASES = new Set(Object.values(TURN_PHASE));
const clean = (value) => String(value || "").trim();

/**
 * Reconciles an action conflict against the execution-liveness fact supplied by
 * the host. All lifecycle interpretation and recovery command construction stay
 * inside the authority boundary.
 */
export async function recoverOrphanedTurn({
  conflict = null,
  identity = {},
  inspectExecution,
  commitTurnLifecycle,
  now = () => Date.now(),
  graceMs = TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs,
} = {}) {
  if (conflict?.reason !== "session_action_conflict") {
    return { recovered: false, reason: "not_session_action_conflict" };
  }
  const lifecycle = conflict?.lifecycle;
  const turnScopeId = clean(lifecycle?.activeTurnScopeId);
  const turn = lifecycle?.turns?.[turnScopeId] || null;
  if (!turnScopeId || !turn) return { recovered: false, reason: "active_turn_unavailable" };
  if (typeof inspectExecution !== "function") {
    return { recovered: false, reason: "execution_liveness_unavailable" };
  }
  const observation = await inspectExecution({
    ...identity,
    turnScopeId,
    dialogProcessId: clean(turn.dialogProcessId),
    executionId: clean(turn.executionId),
  });
  if (observation === true || observation?.alive === true) {
    return { recovered: false, reason: "execution_alive" };
  }
  const updatedAtMs = Date.parse(clean(turn.updatedAt));
  const observedAtMs = Number(observation?.observedAtMs ?? now());
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(observedAtMs)) {
    return { recovered: false, reason: "invalid_recovery_time" };
  }
  if (observedAtMs - updatedAtMs < Number(graceMs)) {
    return { recovered: false, reason: "orphan_grace_period" };
  }
  if (typeof commitTurnLifecycle !== "function") {
    return { recovered: false, reason: "lifecycle_commit_unavailable" };
  }
  const phase = PHASES.has(turn.phase) ? turn.phase : TURN_PHASE.PROCESSING;
  const committed = await commitTurnLifecycle({
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
  });
  return committed?.applied === true || committed?.deduplicated === true
    ? { recovered: true, committed }
    : { recovered: false, reason: committed?.reason || "orphan_commit_failed", committed };
}

/**
 * Recovers a persisted finalize intent. Snapshot I/O and command persistence are
 * injected ports; recoverability and the exact terminal command are authoritative.
 */
export async function recoverTurnFinalize({
  readSnapshot,
  commitTurnLifecycle,
  userId,
  sessionId,
  parentSessionId = "",
  commandId,
  terminalLimit,
} = {}) {
  if (typeof readSnapshot !== "function") {
    return { recovered: false, reason: "lifecycle_snapshot_unavailable" };
  }
  const read = (knownSequence) => readSnapshot({
    userId,
    sessionId,
    parentSessionId,
    commandId,
    knownSequence,
    terminalLimit,
  });
  const initial = await read(undefined);
  if (!initial?.found) {
    return { recovered: false, reason: initial?.reason || "snapshot_not_found", result: initial };
  }
  const turn = initial.snapshot?.activeTurn;
  const intent = turn?.finalizeIntent;
  if (!turn || intent?.retryable !== true || !RECOVERABLE_FINALIZE_STATES.has(clean(turn.state))) {
    return { recovered: false, reason: "no_recoverable_finalize", result: initial };
  }
  if (typeof commitTurnLifecycle !== "function") {
    return { recovered: false, reason: "lifecycle_commit_unavailable", result: initial };
  }
  const isStop = clean(intent.type) === "stop";
  const completionCommitId = clean(intent.commandId || `finalize:${turn.turnScopeId}`);
  const committed = await commitTurnLifecycle({
    userId,
    sessionId,
    parentSessionId,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    commandId: completionCommitId,
    eventType: isStop ? TURN_EVENT.STOP_COMPLETED : TURN_EVENT.COMPLETED,
    phase: isStop ? TURN_PHASE.STOP : TURN_PHASE.COMPLETION,
    expectedRevision: Number(turn.revision || 0),
    completionCommitId,
    terminalStatus: {
      command: isStop ? "user_stopped" : "completed",
      description: isStop ? "停止流程恢复完成" : "完成流程恢复完成",
    },
  });
  if (!committed?.applied && !committed?.deduplicated) {
    return { recovered: false, reason: committed?.reason || "finalize_commit_failed", result: initial, committed };
  }
  return { recovered: true, result: await read(undefined), committed };
}
