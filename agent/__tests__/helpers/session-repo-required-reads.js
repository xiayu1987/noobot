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
