/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionNotFoundError } from "@noobot/session-protocol";

function requireFound(value, userId, sessionId) {
  if (value) return value;
  throw createSessionNotFoundError({ userId, sessionId });
}

export const requiredSessionReads = {
  async requireById(userId, sessionId, options) {
    return requireFound(await this.findById(userId, sessionId, options), userId, sessionId);
  },
  async requireTurnView(userId, sessionId, options) {
    return requireFound(await this.findTurnView(userId, sessionId, options), userId, sessionId);
  },
};

export const fullSessionTurnViews = {
  async findTurnView(userId, sessionId, { turnScopeIds, persistenceContext }) {
    const session = await this.findById(userId, sessionId, { persistenceContext });
    return session ? { session, turnScopeIds } : null;
  },
  async saveTurnView(userId, session, { persistenceContext }) {
    const persisted = await this.findById(userId, session.sessionId, { persistenceContext });
    return this.save(userId, session, {
      expectedAggregateVersion: Number(persisted?.aggregateVersion ?? 0),
      persistenceContext,
    });
  },
};
