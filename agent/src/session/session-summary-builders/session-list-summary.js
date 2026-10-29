/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildMessageSummary } from "./message-summary-projection.js";
import { resolveSessionTitle } from "../entities/session-message-facts.js";
import { requireSessionAggregateVersion } from "@noobot/session-protocol";
import {
  SESSION_SUMMARY_AVAILABILITY,
  requireSessionSummaryEntry,
} from "@noobot/session-protocol/sessions-summary";

export function buildSessionSummary(session, { listFacts }) {
  const { messageCount, lastMessage } = listFacts;
  return requireSessionSummaryEntry({
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    caller: session.caller,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    aggregateVersion: requireSessionAggregateVersion(session.aggregateVersion),
    title: resolveSessionTitle(session),
    messageCount,
    lastMessage: lastMessage ? buildMessageSummary(lastMessage) : null,
    activeTurnScopeId: session.turnLifecycle.activeTurnScopeId,
    availability: SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
  });
}
