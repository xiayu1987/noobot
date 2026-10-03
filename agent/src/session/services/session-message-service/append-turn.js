/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { upsertTurnInSession } from "./turn-upsert.js";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";

export async function appendTurns({
  userId,
  sessionId,
  parentSessionId = "",
  turns = [],
  persistenceContext = null,
} = {}) {
  const sourceTurns = Array.isArray(turns) ? turns : [];
  if (!sourceTurns.length) return { appended: false, reason: "empty_batch", turns: [] };
  const mutation = this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const { session, resolvedParentSessionId } = await this._findSession(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      if (!session) return { appended: false, reason: "session_not_found", turns: [] };

      const persistedTurns = sourceTurns.map((turn = {}) =>
        upsertTurnInSession(this, session, resolvedParentSessionId, {
          ...turn,
          userId,
          sessionId,
          parentSessionId: resolvedParentSessionId,
          persistenceContext,
        }),
      );
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
      return { appended: true, reason: "", turns: persistedTurns };
    },
    parentSessionId,
    persistenceContext,
  );
  return resolveDeletedSessionAs(mutation, { appended: false, turns: [] });
}
