/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_RECOVERY_ACTION, createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import {
  createAvailableSessionDetailEntry,
  createMissingSessionDetailDocument,
  createSessionDetailDocument,
  requireSessionDetailEntry,
} from "@noobot/session-protocol/session-detail";
import {
  SESSION_SUMMARY_AVAILABILITY,
  requireSessionSummaryEntry,
  requireSessionsSummaryPayload,
  SESSIONS_SUMMARY_SCHEMA_VERSION,
} from "@noobot/session-protocol/sessions-summary";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createMessageDeleteResponse } from "@noobot/session-protocol/session-mutation-response";
import { jsonResponse } from "./jsonResponse.js";

const FIXTURE_CREATED_AT = "2026-07-15T10:00:00.000Z";
const FIXTURE_UPDATED_AT = "2026-07-15T10:01:00.000Z";

export function idleTurnLifecycleSnapshot(sessionId) {
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
    generatedAt: FIXTURE_UPDATED_AT,
  });
}

export function detailEntryWithLifecycle({
  sessionId,
  title,
  aggregateVersion,
  messages,
  turnTimings,
  turnLifecycleSnapshot,
}) {
  return createAvailableSessionDetailEntry({
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    createdAt: FIXTURE_CREATED_AT,
    updatedAt: FIXTURE_UPDATED_AT,
    title,
    aggregateVersion,
    turnTimings,
    turnLifecycleSnapshot,
    sessionArtifactEvents: [],
    messages,
  });
}

export function availableDetailEntry({
  sessionId,
  title,
  aggregateVersion,
  messages,
  turnTimings,
}) {
  return detailEntryWithLifecycle({
    sessionId,
    title,
    aggregateVersion,
    messages,
    turnTimings,
    turnLifecycleSnapshot: idleTurnLifecycleSnapshot(sessionId),
  });
}

export function unavailableDetailEntry({ sessionId, unavailableReason }) {
  return requireSessionDetailEntry({
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    availability: SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE,
    unavailableReason,
  });
}

export function availableDetailDocument(entryInput) {
  return createSessionDetailDocument({
    sessionId: entryInput.sessionId,
    sessions: [availableDetailEntry(entryInput)],
  });
}

export function unavailableDetailDocument(entryInput) {
  return createSessionDetailDocument({
    sessionId: entryInput.sessionId,
    sessions: [unavailableDetailEntry(entryInput)],
  });
}

export function missingDetailDocument({ sessionId }) {
  return createMissingSessionDetailDocument({ sessionId });
}

export function detailResponse(document) {
  return { ok: true, status: 200, json: async () => ({ ok: true, ...document }) };
}

export function availableSummaryEntry({
  sessionId,
  title,
  aggregateVersion,
  messageCount,
  updatedAt,
}) {
  return requireSessionSummaryEntry({
    sessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
    createdAt: FIXTURE_CREATED_AT,
    updatedAt,
    aggregateVersion,
    title,
    messageCount,
    lastMessage: null,
    activeTurnScopeId: "",
    availability: SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
  });
}

export function sessionsSummaryResponse({ userId, updatedAt, sessions }) {
  const payload = requireSessionsSummaryPayload({
    schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
    updatedAt,
    sessions,
  });
  return { ok: true, status: 200, json: async () => ({ ok: true, userId, ...payload }) };
}

export function messageDeleteResponse({
  commandId,
  sessionId,
  title,
  aggregateVersion,
  messages,
  deletedCount,
  anchorIndex,
  deletedTurnScopeIds,
  deduplicated,
}) {
  return createMessageDeleteResponse({
    receiptResult: { deletedCount, anchorIndex, deletedTurnScopeIds },
    commandId,
    committedAggregateVersion: aggregateVersion,
    deduplicated,
    detail: availableDetailDocument({
      sessionId,
      title,
      aggregateVersion,
      messages,
      turnTimings: [],
    }),
  });
}

export function mutationSuccessResponse(response) {
  return jsonResponse({ ok: true, ...response });
}

export function deleteSuccessResponse({
  sessionId,
  turnScopeId,
  aggregateVersion,
  messages,
  deletedCount,
  anchorIndex,
}) {
  return mutationSuccessResponse(
    messageDeleteResponse({
      commandId: `delete:${sessionId}:${turnScopeId}`,
      sessionId,
      title: sessionId,
      aggregateVersion,
      messages,
      deletedCount,
      anchorIndex,
      deletedTurnScopeIds: [turnScopeId],
      deduplicated: false,
    }),
  );
}

export function mutationFailureResponse({ status, error, errorCode, currentVersion }) {
  return jsonResponse({ ok: false, error, errorCode, currentVersion }, { status });
}
