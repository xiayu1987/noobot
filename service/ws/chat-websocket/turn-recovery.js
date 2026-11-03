/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { inspectTurnRecovery, recoverActiveTurn } from "@noobot/authoritative-state/application";
import { TURN_RECOVERY_ACTION } from "@noobot/session-protocol/turn-lifecycle";

function readTurnSnapshot({
  bot,
  identity,
  persistenceScope,
  commandId,
  knownSequence,
  terminalLimit,
  resolveRecovery,
}) {
  return bot.session.getTurnLifecycleSnapshot({
    ...identity,
    persistenceScope,
    commandId,
    knownSequence,
    terminalLimit,
    resolveRecovery,
  });
}

export function readAnnotatedTurnSnapshot({
  bot,
  inspectExecution,
  graceMs,
  commandId,
  knownSequence,
  terminalLimit,
  persistenceScope,
  userId,
  sessionId,
}) {
  const identity = { userId, sessionId };
  return readTurnSnapshot({
    bot,
    identity,
    persistenceScope,
    commandId,
    knownSequence,
    terminalLimit,
    resolveRecovery: async (turn) =>
      (await inspectTurnRecovery({ turn, identity, inspectExecution, graceMs })).action,
  });
}

export function recoverPersistedTurn({
  turn,
  inspectExecution,
  graceMs,
  commitTurnLifecycle,
  userId,
  sessionId,
}) {
  return recoverActiveTurn({
    turn,
    identity: { userId, sessionId },
    inspectExecution,
    graceMs,
    commitTurnLifecycle,
  });
}

export async function finalizeTurnSnapshot({
  bot,
  inspectExecution,
  graceMs,
  commitTurnLifecycle,
  commandId,
  terminalLimit,
  persistenceScope,
  userId,
  sessionId,
}) {
  const identity = { userId, sessionId };
  const initial = await readAnnotatedTurnSnapshot({
    ...identity,
    bot,
    inspectExecution,
    graceMs,
    commandId,
    knownSequence: 0,
    terminalLimit,
    persistenceScope,
  });
  if (!initial.found) return { recovered: false, reason: initial.reason };
  const recovered = await recoverPersistedTurn({
    ...identity,
    turn: initial.snapshot.activeTurn,
    inspectExecution,
    graceMs,
    commitTurnLifecycle,
  });
  if (!recovered.recovered) {
    if (recovered.action !== TURN_RECOVERY_ACTION.NONE) return recovered;
    return { ...recovered, snapshot: initial.snapshot };
  }
  const result = await readAnnotatedTurnSnapshot({
    ...identity,
    bot,
    inspectExecution,
    graceMs,
    commandId,
    knownSequence: 0,
    terminalLimit,
    persistenceScope,
  });
  if (!result.found) return { ...recovered, reason: result.reason };
  return { ...recovered, snapshot: result.snapshot };
}
