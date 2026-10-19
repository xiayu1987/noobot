/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildMessageSummary } from "./message-summary-projection.js";
import { resolveSessionTitle } from "../entities/session-message-facts.js";
import { isPlainObject } from "@noobot/shared/value";
import { requireSessionAggregateVersion } from "@noobot/session-protocol";

export const SESSIONS_SUMMARY_SCHEMA_VERSION = 4;

const SESSION_SUMMARY_AVAILABILITY = new Set(["available", "unavailable"]);

export function buildSessionSummary(session, { listFacts }) {
  const { messageCount, lastMessage } = listFacts;
  return {
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    caller: session.caller,
    currentTaskId: session.currentTaskId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    aggregateVersion: requireSessionAggregateVersion(session.aggregateVersion),
    title: resolveSessionTitle(session),
    messageCount,
    lastMessage: lastMessage ? buildMessageSummary(lastMessage) : null,
    availability: "available",
  };
}

export function buildUnavailableSessionSummary({
  sessionId,
  parentSessionId,
  caller,
  metadata,
  error,
}) {
  return {
    sessionId,
    parentSessionId,
    caller,
    currentTaskId: "",
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    title: resolveSessionTitle({ sessionId, customTitle: metadata.title, autoTitle: "" }),
    messageCount: 0,
    lastMessage: null,
    availability: "unavailable",
    unavailableReason: { code: error.code, message: error.message },
  };
}

function sessionsSummaryInvalid(reason) {
  const error = new Error(`sessions summary payload is invalid: ${reason}`);
  error.code = "SESSIONS_SUMMARY_PAYLOAD_INVALID";
  return error;
}

export function requireSessionsSummaryPayload(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.sessions)) {
    throw sessionsSummaryInvalid("sessions must be an array");
  }
  for (const item of payload.sessions) {
    if (!isPlainObject(item) || typeof item.sessionId !== "string" || !item.sessionId) {
      throw sessionsSummaryInvalid("each session requires a sessionId");
    }
    if (!SESSION_SUMMARY_AVAILABILITY.has(item.availability)) {
      throw sessionsSummaryInvalid(`${item.sessionId} has unknown availability`);
    }
    if (item.availability === "available") {
      requireSessionAggregateVersion(item.aggregateVersion);
    }
  }
  return payload;
}
