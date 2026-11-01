/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { upsertTurnInSession } from "./turn-upsert.js";
import { text } from "@noobot/shared/value";

export async function appendTurns({ userId, sessionId, turns, persistenceContext } = {}) {
  if (!Array.isArray(turns) || !turns.length) {
    throw new TypeError("appendTurns requires a non-empty turns array");
  }
  const requestedTurnScopeIds = [...new Set(turns.map((turn) => text(turn?.turnScopeId)))];
  return this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async (scope) => {
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      const view = await this.sessionRepo.requireTurnView(userId, sessionId, {
        turnScopeIds: requestedTurnScopeIds,
        persistenceContext,
      });
      const { session, turnScopeIds } = view;

      const persistedTurns = turns.map((turn = {}) =>
        upsertTurnInSession(this, session, resolvedParentSessionId, {
          ...turn,
          userId,
          sessionId,
        }),
      );
      await this.sessionRepo.saveTurnView(userId, session, {
        turnScopeIds,
        persistenceContext,
      });
      return { turns: persistedTurns };
    },
    { persistenceContext },
  );
}
