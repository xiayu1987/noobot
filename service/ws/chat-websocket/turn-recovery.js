/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { inspectTurnRecovery, recoverActiveTurn } from "@noobot/authoritative-state/application";
import { TURN_RECOVERY_ACTION } from "@noobot/session-protocol/turn-lifecycle";
import { text as clean } from "@noobot/shared/value";

const identityOf = ({ userId, sessionId }) => ({
  userId: clean(userId),
  sessionId: clean(sessionId),
});

export async function readAnnotatedTurnSnapshot({
  bot,
  inspectExecution,
  commandId,
  knownSequence,
  terminalLimit,
  persistenceScope,
  ...identityInput
}) {
  const identity = identityOf(identityInput);
  const result = await bot.session.getTurnLifecycleSnapshot({
    ...identity,
    persistenceScope,
    commandId,
    knownSequence,
    terminalLimit,
  });
  if (!result.found) return result;
  const assessment = await inspectTurnRecovery({
    turn: result.snapshot.activeTurn,
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
  persistenceScope,
  ...identityInput
}) {
  const identity = identityOf(identityInput);
  const initial = await bot.session.getTurnLifecycleSnapshot({
    ...identity,
    persistenceScope,
    commandId,
    knownSequence: 0,
    terminalLimit,
  });
  if (!initial.found) return { recovered: false, reason: initial.reason };
  const recovered = await recoverPersistedTurn({
    ...identity,
    turn: initial.snapshot.activeTurn,
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
    persistenceScope,
  });
  if (!result.found) return { ...recovered, reason: result.reason };
  return { ...recovered, snapshot: result.snapshot };
}
