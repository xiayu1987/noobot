/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAuthoritativeTurnSnapshot } from "@noobot/authoritative-state/application";
import { isUnsuccessfulTurnState } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

export function selectPresentedSessionLifecycleTurns(lifecycle = null) {
  const turns = lifecycle?.turns && typeof lifecycle.turns === "object" ? lifecycle.turns : {};
  const activeTurnScopeId = text(lifecycle?.activeTurnScopeId);
  if (activeTurnScopeId && !turns[activeTurnScopeId]) {
    throw new TypeError("active Turn presentation invariant failed: turn_missing");
  }
  const entries = Object.entries(turns);
  for (const [turnScopeId, turn] of entries) {
    if (text(turn?.turnScopeId) !== turnScopeId) {
      throw new TypeError("Turn presentation invariant failed: turn_scope_mismatch");
    }
  }
  return entries
    .map(([, turn]) => turn)
    .filter(
      (turn) =>
        text(turn?.turnScopeId) === activeTurnScopeId || isUnsuccessfulTurnState(turn.state),
    )
    .sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0));
}

function collectSessionPresentationTurnScopeIds(session, messageTurnScopeIds) {
  return [
    ...new Set(
      [
        ...messageTurnScopeIds,
        ...selectPresentedSessionLifecycleTurns(session?.turnLifecycle).map((turn) =>
          text(turn?.turnScopeId),
        ),
      ].filter(Boolean),
    ),
  ];
}

export function createSessionTurnLifecycleSnapshot({
  session,
  messageTurnScopeIds,
  commandId,
  knownSequence,
  terminalLimit,
  recovery,
  generatedAt,
}) {
  return createAuthoritativeTurnSnapshot({
    lifecycle: session.turnLifecycle,
    turnTimings: session.turnTimings,
    terminalTurnScopeIds: collectSessionPresentationTurnScopeIds(session, messageTurnScopeIds),
    commandId,
    sessionId: session.sessionId,
    knownSequence,
    terminalLimit,
    recovery,
    generatedAt,
  });
}
