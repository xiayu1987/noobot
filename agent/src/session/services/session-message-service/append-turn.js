/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { upsertTurnInSession } from "./turn-upsert.js";
import { SESSION_NOT_FOUND_REASON } from "@noobot/session-protocol";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text } from "@noobot/shared/value";

export async function appendTurns({ userId, sessionId, turns = [], persistenceContext } = {}) {
  const sourceTurns = Array.isArray(turns) ? turns : [];
  if (!sourceTurns.length) return { appended: false, reason: "empty_batch", turns: [] };
  const requestedTurnScopeIds = [...new Set(sourceTurns.map((turn) => text(turn?.turnScopeId)))];
  const mutation = this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async (scope) => {
      const resolvedParentSessionId = scope.resolvedParentSessionId;
      const view = await this.sessionRepo.findTurnView(userId, sessionId, {
        turnScopeIds: requestedTurnScopeIds,
        persistenceContext,
      });
      if (!view) return { appended: false, reason: SESSION_NOT_FOUND_REASON, turns: [] };
      const { session, turnScopeIds } = view;

      const persistedTurns = sourceTurns.map((turn = {}) =>
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
      return { appended: true, reason: "", turns: persistedTurns };
    },
    { persistenceContext },
  );
  return resolveDeletedSessionAs(mutation, { appended: false, turns: [] });
}
