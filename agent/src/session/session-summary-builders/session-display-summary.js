/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionTurnLifecycleSnapshot } from "../session-turn-read-model.js";
import { buildSessionDisplayEntries } from "./display-message-list.js";
import { buildSessionDisplayStats, countSessionDisplaySources } from "./display-summary-stats.js";
import { attachSessionToolArtifacts } from "./display-tool-artifacts.js";
import { resolveSessionTitle } from "@noobot/session-protocol";
import {
  isTransferEnvelopeField,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import { text, isObjectLike } from "@noobot/shared/value";
import {
  TURN_RECOVERY_ACTION,
  TURN_SNAPSHOT_TERMINAL_LIMIT,
} from "@noobot/session-protocol/turn-lifecycle";

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

function assertValidTransferEnvelopes(payload) {
  if (hasValidTransferEnvelopes(payload)) return;
  const error = new Error("Session display summary contains an invalid transfer envelope");
  error.code = "SESSION_DISPLAY_SUMMARY_TRANSFER_INVALID";
  throw error;
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
    messageTurnScopeIds: session.messages.map((message) => text(message.turnScopeId)),
    commandId: `session-summary:${sessionId}:${lifecycle.sequence}`,
    knownSequence: 0,
    terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT,
    recovery: TURN_RECOVERY_ACTION.NONE,
    generatedAt: session.updatedAt,
  });
}

export function buildSessionDisplayProjection(session, options) {
  return buildSessionDisplayProjectionFromCounts(
    session,
    countSessionDisplaySources(session.messages),
    options,
  );
}

function buildSessionDisplayRows(session, options) {
  const entries = buildSessionDisplayEntries({
    ...options,
    messages: session.messages,
    lifecycle: session.turnLifecycle,
  });
  const displayMessages = entries.map(({ row }) => row);
  const toolArtifactStats = attachSessionToolArtifacts(session, displayMessages, session.sessionId);
  return { entries, toolArtifactStats };
}

export function buildSessionDisplayRowsAndStats(session, sourceCounts, options) {
  const { entries, toolArtifactStats } = buildSessionDisplayRows(session, options);
  const displayMessages = entries.map(({ row }) => row);
  const stats = buildSessionDisplayStats({ sourceCounts, displayMessages, ...toolArtifactStats });
  return { entries, stats };
}

export function buildSessionDisplayProjectionFromCounts(session, sourceCounts, options) {
  const context = createDisplaySummaryContext(session);
  const { turnTimings, sessionId } = context;
  const { entries, stats } = buildSessionDisplayRowsAndStats(session, sourceCounts, options);
  const summary = {
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
    messages: entries.map(({ row }) => row),
    stats,
  };
  assertValidTransferEnvelopes(summary);
  return summary;
}
