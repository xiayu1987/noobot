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
    dialogOrder: [],
    turnTimings: [],
    turnLifecycle: createEmptyTurnLifecycle(),
  };
}

export function applySessionMessageFacts(session) {
  for (const message of session.messages) registerSessionMessageFacts(session, message);
  return session;
}
