/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionTurnLifecycleSnapshot } from "../session-turn-read-model.js";
import { buildSessionDisplayMessages } from "./display-message-list.js";
import { buildSessionDisplayStats } from "./display-summary-stats.js";
import { attachSessionToolArtifacts } from "./display-tool-artifacts.js";
import {
  isTransferEnvelopeField,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import {
  createSessionDisplaySourceRevision,
  SESSION_SOURCE_SCHEMA_VERSION,
} from "../session-display-source-revision.js";

export const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 26;
export const SESSION_DETAIL_MESSAGE_PROJECTION = "canonical-presentation";

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
  if (!value || typeof value !== "object") return true;
  if (visited.has(value)) return true;
  visited.add(value);
  if (Array.isArray(value)) return value.every((item) => hasValidTransferEnvelopes(item, visited));
  return Object.entries(value).every((entry) => isValidTransferEntry(entry, visited));
}

function hasExpectedSummaryVersions(payload) {
  return (
    Number(payload?.schemaVersion || 0) === SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION &&
    Number(payload?.source?.sessionSchemaVersion || 0) === SESSION_SOURCE_SCHEMA_VERSION
  );
}

function hasValidSourceRevision(payload) {
  return /^sha256:[0-9a-f]{64}$/.test(String(payload?.source?.revision || ""));
}

function hasMatchingSessionId(payload, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  return !normalizedSessionId || String(payload?.sessionId || "").trim() === normalizedSessionId;
}

export function isSessionDisplaySummaryPayload(payload = null, sessionId = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (
    hasExpectedSummaryVersions(payload) &&
    hasValidSourceRevision(payload) &&
    hasMatchingSessionId(payload, sessionId) &&
    hasValidTransferEnvelopes(payload)
  );
}

export function isSessionDisplaySummaryCurrent(payload = null, sessionManifest = null) {
  if (!isSessionDisplaySummaryPayload(payload, sessionManifest?.sessionId)) return false;
  if (Number(sessionManifest?.schemaVersion || 0) !== SESSION_SOURCE_SCHEMA_VERSION) return false;
  if (Number(payload?.aggregateVersion || 0) !== Number(sessionManifest?.aggregateVersion || 0))
    return false;
  if (Number(payload?.stats?.messageCount || 0) !== sessionManifest?.messageOrder?.length)
    return false;
  return payload.source.revision === createSessionDisplaySourceRevision(sessionManifest);
}

function text(value) {
  return String(value || "").trim();
}

function createDisplaySummaryContext(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    session,
    messages,
    turnTimings: Array.isArray(session.turnTimings) ? session.turnTimings : [],
    sessionId: text(session.sessionId),
    lifecycle:
      session.turnLifecycle && typeof session.turnLifecycle === "object"
        ? session.turnLifecycle
        : null,
  };
}

function resolveSessionTitle(session, messages, sessionId) {
  const customTitle = text(session.customTitle);
  if (customTitle) return customTitle;
  const firstUserMessage = messages.find(
    (message) =>
      message?.injectedMessage !== true &&
      text(message?.role).toLowerCase() === "user" &&
      text(message?.content),
  );
  return firstUserMessage
    ? String(firstUserMessage.content || "").slice(0, 20)
    : sessionId.slice(0, 8);
}

function buildTurnLifecycleSnapshot({ session, sessionId, lifecycle }) {
  if (!lifecycle) return null;
  return createSessionTurnLifecycleSnapshot({
    session,
    commandId: `session-summary:${sessionId}:${Number(lifecycle.sequence || 0)}`,
    generatedAt: text(session.updatedAt),
  });
}

export function buildSessionDisplaySummary(session = {}) {
  const context = createDisplaySummaryContext(session);
  const { messages, turnTimings, sessionId, lifecycle } = context;
  const displayMessages = buildSessionDisplayMessages({ messages, lifecycle, sessionId });
  const toolArtifactStats = attachSessionToolArtifacts(session, displayMessages, sessionId);
  return {
    schemaVersion: SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
    source: {
      sessionSchemaVersion: SESSION_SOURCE_SCHEMA_VERSION,
      revision: createSessionDisplaySourceRevision(session),
    },
    sessionId,
    parentSessionId: text(session.parentSessionId),
    caller: text(session.caller || "user") || "user",
    currentTaskId: text(session.currentTaskId),
    createdAt: text(session.createdAt),
    updatedAt: text(session.updatedAt),
    title: resolveSessionTitle(session, messages, sessionId),
    aggregateVersion: session.aggregateVersion,
    turnTimings,
    turnLifecycleSnapshot: buildTurnLifecycleSnapshot(context),
    sessionArtifactEvents: Array.isArray(session.sessionArtifactEvents)
      ? session.sessionArtifactEvents
      : [],
    messages: displayMessages,
    stats: buildSessionDisplayStats({ messages, displayMessages, ...toolArtifactStats }),
  };
}
