/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalSessionMessages } from "./canonical-session-messages.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./session-message-facts.js";
import { buildSessionDisplayProjection } from "../../src/session/session-summary-builders/session-display-summary.js";
import { projectThinkingTimeline } from "@noobot/event-protocol/thinking-detail-projection";

export function projectionSession(sessionPayload) {
  return applySessionMessageFacts({
    ...createTestSessionRequiredFields(),
    ...sessionPayload,
    messages: canonicalSessionMessages(sessionPayload.messages, sessionPayload.sessionId),
  });
}

export function buildFixtureDisplaySummary(sessionPayload) {
  return buildSessionDisplayProjection(projectionSession(sessionPayload));
}

export function buildFixtureDisplayAndThinking(sessionPayload, turnScopeId) {
  const session = projectionSession(sessionPayload);
  return {
    summary: buildSessionDisplayProjection(session),
    detail: projectThinkingTimeline(session.messages, { turnScopeId }),
  };
}
