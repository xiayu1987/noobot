/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createSubSessionMessageRegistry() {
  return { sessions: {} };
}

export function createEmptySubSession(sessionId) {
  return {
    sessionId,
    messages: [],
    eventsById: {},
    sequenceByScopeKey: {},
    sequenceByDomain: {},
  };
}
