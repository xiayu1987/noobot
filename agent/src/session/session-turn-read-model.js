/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAuthoritativeTurnSnapshot } from "@noobot/authoritative-state/application";

const TERMINAL_PRESENTATION_STATES = new Set(["user_stopped", "error", "timeout"]);

const text = (value) => String(value || "").trim();

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
    .filter((turn) => {
      const terminal = text(turn?.terminalStatus?.status || turn?.executionState).toLowerCase();
      return (
        text(turn?.turnScopeId) === activeTurnScopeId || TERMINAL_PRESENTATION_STATES.has(terminal)
      );
    })
    .sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0));
}

export function collectSessionPresentationTurnScopeIds(session = {}) {
  return [
    ...new Set(
      [
        ...(Array.isArray(session?.messages) ? session.messages : []).map((message) =>
          text(message?.turnScopeId),
        ),
        ...selectPresentedSessionLifecycleTurns(session?.turnLifecycle).map((turn) =>
          text(turn?.turnScopeId),
        ),
      ].filter(Boolean),
    ),
  ];
}

export function createSessionTurnLifecycleSnapshot({
  session = {},
  commandId = "",
  userId = "",
  knownSequence,
  terminalLimit = 10,
  generatedAt,
} = {}) {
  return createAuthoritativeTurnSnapshot({
    lifecycle: session.turnLifecycle,
    turnTimings: session.turnTimings,
    terminalTurnScopeIds: collectSessionPresentationTurnScopeIds(session),
    commandId,
    userId,
    sessionId: text(session.sessionId),
    knownSequence,
    terminalLimit,
    ...(generatedAt ? { generatedAt } : {}),
  });
}
