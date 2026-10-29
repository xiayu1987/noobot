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

const FIXED_AT = "2026-01-01T00:00:00.000Z";

export function createSessionCrudServiceStub(readSession) {
  return {
    async getSessionDisplayData() {
      const session = readSession();
      const entry = createAvailableSessionDetailEntry({
        sessionId: session.sessionId,
        parentSessionId: session.parentSessionId,
        caller: SESSION_CALLER.USER,
        createdAt: FIXED_AT,
        updatedAt: FIXED_AT,
        title: session.sessionId,
        aggregateVersion: session.aggregateVersion,
        turnTimings: [],
        turnLifecycleSnapshot: createTurnLifecycleSnapshot({
          commandId: `snapshot-${session.sessionId}`,
          sessionId: session.sessionId,
          sequence: 0,
          activeTurnScopeId: "",
          activeTurn: null,
          recentTerminalTurns: [],
          replacedTurns: [],
          unchanged: false,
          recovery: TURN_RECOVERY_ACTION.NONE,
          generatedAt: FIXED_AT,
        }),
        sessionArtifactEvents: [],
        messages: structuredClone(session.messages),
      });
      return createSessionDetailDocument({ sessionId: session.sessionId, sessions: [entry] });
    },
  };
}
