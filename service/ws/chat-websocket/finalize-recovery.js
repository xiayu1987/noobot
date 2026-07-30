/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_EVENT, TURN_PHASE } from "@noobot/authoritative-state/contracts";

const RECOVERABLE_FINALIZE_STATES = new Set([
  "completion_requesting",
  "completion_failed",
  "stopping",
  "stop_failed",
]);

export async function recoverTurnFinalize({
  bot,
  commitTurnLifecycle,
  userId,
  sessionId,
  parentSessionId = "",
  commandId,
  terminalLimit,
} = {}) {
  const reader = bot?.getTurnLifecycleSnapshot;
  if (typeof reader !== "function") return { recovered: false, reason: "lifecycle_snapshot_unavailable" };

  const read = (knownSequence) => reader.call(bot, {
    userId,
    sessionId,
    parentSessionId,
    commandId,
    knownSequence,
    terminalLimit,
  });
  const initial = await read(undefined);
  if (!initial?.found) return { recovered: false, reason: initial?.reason || "snapshot_not_found", result: initial };

  const turn = initial.snapshot?.activeTurn;
  const intent = turn?.finalizeIntent;
  if (!turn || intent?.retryable !== true || !RECOVERABLE_FINALIZE_STATES.has(String(turn.state || ""))) {
    return { recovered: false, reason: "no_recoverable_finalize", result: initial };
  }

  const isStop = String(intent.type || "") === "stop";
  const completionCommitId = String(intent.commandId || `finalize:${turn.turnScopeId}`).trim();
  const committed = await commitTurnLifecycle({
    userId,
    sessionId,
    parentSessionId,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    commandId: completionCommitId,
    eventType: isStop ? TURN_EVENT.STOP_COMPLETED : TURN_EVENT.COMPLETED,
    phase: isStop ? TURN_PHASE.STOP : TURN_PHASE.COMPLETION,
    expectedRevision: turn.revision,
    completionCommitId,
    terminalStatus: {
      command: isStop ? "user_stopped" : "completed",
      description: isStop ? "停止流程恢复完成" : "完成流程恢复完成",
    },
  });
  if (!committed?.applied && !committed?.deduplicated) {
    return { recovered: false, reason: committed?.reason || "finalize_commit_failed", result: initial };
  }
  return { recovered: true, result: await read(undefined), committed };
}
