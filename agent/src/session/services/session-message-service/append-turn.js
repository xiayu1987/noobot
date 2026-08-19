/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { upsertTurnInSession } from "./turn-upsert.js";

export async function appendTurns({
  userId,
  sessionId,
  parentSessionId = "",
  turns = [],
  persistenceContext = null,
} = {}) {
  const sourceTurns = Array.isArray(turns) ? turns : [];
  if (!sourceTurns.length) return [];
  return this._withSessionMutation(
    userId,
    sessionId,
    async () => {
      const resolvedParentSessionId = await this._resolveParentSessionId(
        userId,
        sessionId,
        parentSessionId,
        persistenceContext,
      );
      const session = await this.sessionRepo.findById(
        userId,
        sessionId,
        resolvedParentSessionId,
        persistenceContext,
      );
      if (!session) return { appended: false, reason: "session_not_found" };

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
      return persistedTurns;
    },
    parentSessionId,
    persistenceContext,
  );
}

export async function appendTurn(payload = {}) {
  const result = await appendTurns.call(this, {
    userId: payload.userId,
    sessionId: payload.sessionId,
    parentSessionId: payload.parentSessionId,
    turns: [payload],
    persistenceContext: payload.persistenceContext,
  });
  return Array.isArray(result) ? result[0] : result;
}
