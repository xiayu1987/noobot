/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { inspectTurnRecovery, recoverActiveTurn } from "@noobot/authoritative-state/application";
import { TURN_RECOVERY_ACTION } from "@noobot/session-protocol/turn-lifecycle";
import { text as clean } from "@noobot/shared/value";

function snapshotReader(bot) {
  const reader = bot?.getTurnLifecycleSnapshot;
  return typeof reader === "function" ? (request) => reader.call(bot, request) : null;
}

const identityOf = ({ userId, sessionId, parentSessionId = "" } = {}) => ({
  userId: clean(userId),
  sessionId: clean(sessionId),
  parentSessionId: clean(parentSessionId),
});

export async function readAnnotatedTurnSnapshot({
  bot,
  inspectExecution,
  commandId,
  knownSequence,
  terminalLimit,
  ...identityInput
} = {}) {
  const read = snapshotReader(bot);
  if (!read) return { found: false, reason: "lifecycle_snapshot_unavailable" };
  const identity = identityOf(identityInput);
  const result = await read({ ...identity, commandId, knownSequence, terminalLimit });
  if (!result?.found) return result || { found: false, reason: "snapshot_not_found" };
  const assessment = await inspectTurnRecovery({
    turn: result.snapshot?.activeTurn || null,
    identity,
    inspectExecution,
  });
  return { ...result, snapshot: { ...result.snapshot, recovery: assessment.action } };
}

export function recoverPersistedTurn({ turn, inspectExecution, commitTurnLifecycle, ...input }) {
  return recoverActiveTurn({
    turn,
    identity: identityOf(input),
    inspectExecution,
    commitTurnLifecycle,
  });
}

export async function finalizeTurnSnapshot({
  bot,
  inspectExecution,
  commitTurnLifecycle,
  commandId,
  terminalLimit,
  ...identityInput
} = {}) {
  const read = snapshotReader(bot);
  if (!read) return { recovered: false, reason: "lifecycle_snapshot_unavailable" };
  const identity = identityOf(identityInput);
  const initial = await read({ ...identity, commandId, knownSequence: 0, terminalLimit });
  if (!initial?.found) {
    return { recovered: false, reason: initial?.reason || "snapshot_not_found" };
  }
  const recovered = await recoverPersistedTurn({
    ...identity,
    turn: initial.snapshot?.activeTurn || null,
    inspectExecution,
    commitTurnLifecycle,
  });
  if (!recovered.recovered) {
    if (recovered.action !== TURN_RECOVERY_ACTION.NONE) return recovered;
    return {
      ...recovered,
      snapshot: { ...initial.snapshot, recovery: TURN_RECOVERY_ACTION.NONE },
    };
  }
  const result = await readAnnotatedTurnSnapshot({
    ...identity,
    bot,
    inspectExecution,
    commandId,
    knownSequence: 0,
    terminalLimit,
  });
  if (!result?.found) return { ...recovered, reason: result?.reason || "snapshot_not_found" };
  return { ...recovered, snapshot: result.snapshot };
}
