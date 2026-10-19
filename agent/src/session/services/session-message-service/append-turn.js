/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { upsertTurnInSession } from "./turn-upsert.js";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text } from "@noobot/shared/value";

export async function appendTurns({
  userId,
  sessionId,
  parentSessionId = "",
  turns = [],
  persistenceContext = null,
} = {}) {
  const sourceTurns = Array.isArray(turns) ? turns : [];
  if (!sourceTurns.length) return { appended: false, reason: "empty_batch", turns: [] };
  const requestedTurnScopeIds = [...new Set(sourceTurns.map((turn) => text(turn?.turnScopeId)))];
  const mutation = this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      const view = await this.sessionRepo.findTurnView(userId, sessionId, resolvedParentSessionId, {
        turnScopeIds: requestedTurnScopeIds,
        persistenceContext,
      });
      if (!view) return { appended: false, reason: "session_not_found", turns: [] };
      const { session, turnScopeIds } = view;

      const persistedTurns = sourceTurns.map((turn = {}) =>
        upsertTurnInSession(this, session, resolvedParentSessionId, {
          ...turn,
          userId,
          sessionId,
          parentSessionId: resolvedParentSessionId,
          persistenceContext,
        }),
      );
      await this.sessionRepo.saveTurnView(userId, session, resolvedParentSessionId, {
        turnScopeIds,
        persistenceContext,
      });
      return { appended: true, reason: "", turns: persistedTurns };
    },
    parentSessionId,
    persistenceContext,
  );
  return resolveDeletedSessionAs(mutation, { appended: false, turns: [] });
}
