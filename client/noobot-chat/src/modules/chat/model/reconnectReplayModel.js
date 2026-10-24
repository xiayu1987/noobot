/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTerminalTurnState } from "@noobot/session-protocol";

function isSessionEntryRunning(sessionEntry) {
  const { snapshot } = sessionEntry.replayBatch;
  if (snapshot === null) return false;
  const { activeTurn } = snapshot.payload;
  return activeTurn !== null && !isTerminalTurnState(activeTurn.state);
}

function hasPendingInteractions(sessionEntry) {
  return sessionEntry.replayBatch.pendingInteractions.length > 0;
}

function findRecoverableReconnectSessionId(sessions, preferredSessionId) {
  if (
    preferredSessionId &&
    sessions.some((sessionEntry) => sessionEntry.sessionId === preferredSessionId)
  ) {
    return preferredSessionId;
  }
  for (const sessionEntry of sessions) {
    const { sessionId } = sessionEntry;
    if (isSessionEntryRunning(sessionEntry)) return sessionId;
    if (hasPendingInteractions(sessionEntry)) return sessionId;
  }
  return "";
}

export { findRecoverableReconnectSessionId };
