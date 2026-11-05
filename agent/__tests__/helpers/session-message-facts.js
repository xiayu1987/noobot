/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { registerSessionMessageFacts } from "../../src/session/entities/session-message-facts.js";

export function createTestSessionRequiredFields() {
  return {
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    messages: [],
    sessionArtifactEvents: [],
    dialogOrder: [],
    turnTimings: [],
    turnLifecycle: createEmptyTurnLifecycle(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function applySessionMessageFacts(session) {
  for (const message of session.messages) registerSessionMessageFacts(session, message);
  return session;
}
