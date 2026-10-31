/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionTurnLifecycleSnapshot } from "../session-turn-read-model.js";
import { buildSessionDisplayMessages } from "./display-message-list.js";
import { buildSessionDisplayStats } from "./display-summary-stats.js";
import { attachSessionToolArtifacts } from "./display-tool-artifacts.js";
import { resolveSessionTitle } from "../entities/session-message-facts.js";
import {
  isTransferEnvelopeField,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import {
  createSessionDisplaySourceRevision,
  SESSION_SOURCE_SCHEMA_VERSION,
} from "../session-display-source-revision.js";
import { text, isObjectLike, isPlainObject } from "@noobot/shared/value";
import { requireSessionAggregateVersion } from "@noobot/session-protocol";
import {
  TURN_RECOVERY_ACTION,
  TURN_SNAPSHOT_TERMINAL_LIMIT,
} from "@noobot/session-protocol/turn-lifecycle";

export const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 37;

function isValidTransferEnvelopeList(value) {
  return (
    Array.isArray(value) &&
    value.every((envelope) => validateTransferEnvelope(envelope, { strict: false }).ok)
  );
}

function isValidTransferEntry([key, child], visited) {
  return isTransferEnvelopeField(key)
    ? isValidTransferEnvelopeList(child)
    : hasValidTransferEnvelopes(child, visited);
}

function hasValidTransferEnvelopes(value, visited = new WeakSet()) {
  if (!isObjectLike(value)) return true;
  if (visited.has(value)) return true;
  visited.add(value);
  if (Array.isArray(value)) return value.every((item) => hasValidTransferEnvelopes(item, visited));
  return Object.entries(value).every((entry) => isValidTransferEntry(entry, visited));
}

function hasExpectedSummaryVersions(payload) {
  return (
    payload.schemaVersion === SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION &&
    Number(payload?.source?.sessionSchemaVersion || 0) === SESSION_SOURCE_SCHEMA_VERSION
  );
}

function hasValidSourceRevision(payload) {
  return /^sha256:[0-9a-f]{64}$/.test(String(payload?.source?.revision || ""));
}

function hasMatchingSessionId(payload, sessionId) {
  const normalizedSessionId = text(sessionId);
  return !normalizedSessionId || text(payload?.sessionId) === normalizedSessionId;
}

function assertValidTransferEnvelopes(payload) {
  if (hasValidTransferEnvelopes(payload)) return;
  const error = new Error("Session display summary contains an invalid transfer envelope");
  error.code = "SESSION_DISPLAY_SUMMARY_TRANSFER_INVALID";
  throw error;
}

export function isSessionDisplaySummaryPayload(payload = null, sessionId = "") {
  if (!isPlainObject(payload)) return false;
  return (
    hasExpectedSummaryVersions(payload) &&
    hasValidSourceRevision(payload) &&
    hasMatchingSessionId(payload, sessionId)
  );
}

export function isSessionDisplaySummaryCurrent(payload = null, sessionManifest = null) {
  if (!isSessionDisplaySummaryPayload(payload, sessionManifest?.sessionId)) return false;
  if (sessionManifest?.schemaVersion !== SESSION_SOURCE_SCHEMA_VERSION) return false;
  if (
    payload.aggregateVersion !== requireSessionAggregateVersion(sessionManifest?.aggregateVersion)
  )
    return false;
  if (Number(payload?.stats?.messageCount || 0) !== sessionManifest?.messageOrder?.length)
    return false;
  return payload.source.revision === createSessionDisplaySourceRevision(sessionManifest);
}

function createDisplaySummaryContext(session) {
  const { messages } = session;
  return {
    session,
    messages,
    turnTimings: session.turnTimings,
    sessionId: session.sessionId,
    lifecycle: session.turnLifecycle,
  };
}

function buildTurnLifecycleSnapshot({ session, sessionId, lifecycle }) {
  return createSessionTurnLifecycleSnapshot({
    session,
    commandId: `session-summary:${sessionId}:${lifecycle.sequence}`,
    knownSequence: 0,
    terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT,
    recovery: TURN_RECOVERY_ACTION.NONE,
    generatedAt: session.updatedAt,
  });
}

export function buildSessionDisplaySummary(session) {
  const context = createDisplaySummaryContext(session);
  const { messages, turnTimings, sessionId, lifecycle } = context;
  const displayMessages = buildSessionDisplayMessages({ messages, lifecycle });
  const toolArtifactStats = attachSessionToolArtifacts(session, displayMessages, sessionId);
  const summary = {
    schemaVersion: SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
    source: {
      sessionSchemaVersion: SESSION_SOURCE_SCHEMA_VERSION,
      revision: createSessionDisplaySourceRevision(session),
    },
    sessionId,
    parentSessionId: session.parentSessionId,
    caller: session.caller,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    title: resolveSessionTitle(session),
    aggregateVersion: session.aggregateVersion,
    turnTimings,
    turnLifecycleSnapshot: buildTurnLifecycleSnapshot(context),
    sessionArtifactEvents: session.sessionArtifactEvents,
    messages: displayMessages,
    stats: buildSessionDisplayStats({ messages, displayMessages, ...toolArtifactStats }),
  };
  assertValidTransferEnvelopes(summary);
  return summary;
}
