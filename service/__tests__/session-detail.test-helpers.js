/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_RECOVERY_ACTION, createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import {
  createAvailableSessionDetailEntry,
  createSessionDetailDocument,
} from "@noobot/session-protocol/session-detail";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

function emptyTurnLifecycleSnapshot(sessionId) {
  return createTurnLifecycleSnapshot({
    commandId: `snapshot-${sessionId}`,
    sessionId,
    sequence: 0,
    activeTurnScopeId: "",
    activeTurn: null,
    recentTerminalTurns: [],
    replacedTurns: [],
    unchanged: false,
    recovery: TURN_RECOVERY_ACTION.NONE,
    generatedAt: "2026-05-14T00:01:00.000Z",
  });
}

export function availableDetailEntry({ sessionId, aggregateVersion, messages }) {
  return createAvailableSessionDetailEntry({
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:01:00.000Z",
    title: sessionId,
    aggregateVersion,
    turnTimings: [],
    turnLifecycleSnapshot: emptyTurnLifecycleSnapshot(sessionId),
    sessionArtifactEvents: [],
    messages,
  });
}

export function availableDetailDocument(entryInput) {
  return createSessionDetailDocument({
    sessionId: entryInput.sessionId,
    sessions: [availableDetailEntry(entryInput)],
  });
}
