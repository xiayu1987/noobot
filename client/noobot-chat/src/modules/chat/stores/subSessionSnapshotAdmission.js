/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_SEQUENCE_DOMAIN } from "@noobot/event-protocol/message-event";
import { WORKFLOW_SEQUENCE_DOMAIN } from "@noobot/event-protocol/workflow-runtime-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";

function text(value) {
  return String(value || "").trim();
}

function num(value) {
  return Number(value || 0);
}

const TURN_RUNTIME_UNAVAILABLE = { applied: false, reason: "turn_runtime_unavailable" };

export function buildSnapshotContextFacet(snapshotContext = {}) {
  return {
    source: text(snapshotContext?.source) || "unknown",
    eventId: text(snapshotContext?.eventId),
    sequenceDomain: text(snapshotContext?.sequenceDomain),
    authoritativeSequence: num(snapshotContext?.authoritativeSequence),
    transportSequence: num(snapshotContext?.transportSequence),
  };
}

export function resolveAppliedAggregateVersion(current = {}) {
  return num(current?.sequenceByDomain?.[WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT]);
}

export function buildSubSessionSnapshotRegistryEntry({
  current = {},
  sessionDoc = {},
  sessionId,
  messages = [],
  aggregateVersion,
}) {
  const {
    status: _persistedStatus,
    state: _persistedState,
    turnTimings: _persistedTurnTimings,
    ...messageSnapshot
  } = sessionDoc || {};
  return {
    ...current,
    ...messageSnapshot,
    id: sessionId,
    sessionId,
    messages,
    sequence: num(current.sequence),
    sequenceDomain: text(current.sequenceDomain) || MESSAGE_EVENT_SEQUENCE_DOMAIN,
    sequenceByDomain: {
      ...(current.sequenceByDomain || {}),
      [WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT]: aggregateVersion,
    },
    sequenceByScopeKey: { ...(current.sequenceByScopeKey || {}) },
    revision: num(current.revision),
    revisionByDomain: { ...(current.revisionByDomain || {}) },
    eventsById: current.eventsById || {},
    updatedAt: new Date().toISOString(),
  };
}

function applyLifecycleSnapshot(sessionDoc, applyTurnLifecycleSnapshot) {
  if (typeof applyTurnLifecycleSnapshot !== "function") return TURN_RUNTIME_UNAVAILABLE;
  return applyTurnLifecycleSnapshot(sessionDoc?.turnLifecycleSnapshot);
}

function applyTimingSnapshot(sessionDoc, sessionId, applyTurnTimingSnapshot) {
  if (typeof applyTurnTimingSnapshot !== "function") return TURN_RUNTIME_UNAVAILABLE;
  return applyTurnTimingSnapshot({
    sessionId,
    turnTimings: Array.isArray(sessionDoc?.turnTimings) ? sessionDoc.turnTimings : [],
  });
}

function lifecycleRejected(lifecycleResult = {}) {
  return lifecycleResult?.applied === false && lifecycleResult?.deduplicated !== true;
}

function resolveStaleReason(aggregateVersion, appliedAggregateVersion) {
  return aggregateVersion === appliedAggregateVersion
    ? "duplicate_snapshot_version"
    : "stale_snapshot";
}

function logSnapshotRejected({
  sessionId,
  sessionDoc,
  current,
  aggregateVersion,
  appliedAggregateVersion,
  contextFacet,
  reason,
}) {
  logWorkflowDiagnostics("frontend.workflowSubSession.snapshotRejected", () => ({
    sessionId,
    parentSessionId: text(sessionDoc?.parentSessionId || current?.parentSessionId),
    workflowRunId: text(sessionDoc?.workflowRunId || current?.workflowRunId),
    nodeExecutionId: text(sessionDoc?.nodeExecutionId || current?.nodeExecutionId),
    aggregateVersion,
    appliedAggregateVersion,
    ...contextFacet,
    reason,
  }));
}

export function evaluateSubSessionSnapshotAdmission({
  sessionId,
  sessionDoc = {},
  snapshotContext = {},
  current = {},
  applyTurnLifecycleSnapshot = null,
  applyTurnTimingSnapshot = null,
}) {
  const lifecycleResult = applyLifecycleSnapshot(sessionDoc, applyTurnLifecycleSnapshot);
  if (lifecycleRejected(lifecycleResult)) {
    return {
      admitted: false,
      result: {
        applied: false,
        reason: lifecycleResult?.reason || "invalid_lifecycle_snapshot",
        lifecycleResult,
      },
    };
  }
  const timingResult = applyTimingSnapshot(sessionDoc, sessionId, applyTurnTimingSnapshot);
  const aggregateVersion = num(sessionDoc?.aggregateVersion);
  if (!Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
    return {
      admitted: false,
      result: { applied: false, reason: "invalid_snapshot_version", current },
    };
  }
  const appliedAggregateVersion = resolveAppliedAggregateVersion(current);
  if (appliedAggregateVersion && aggregateVersion <= appliedAggregateVersion) {
    const reason = resolveStaleReason(aggregateVersion, appliedAggregateVersion);
    logSnapshotRejected({
      sessionId,
      sessionDoc,
      current,
      aggregateVersion,
      appliedAggregateVersion,
      contextFacet: buildSnapshotContextFacet(snapshotContext),
      reason,
    });
    return { admitted: false, result: { applied: false, reason, current } };
  }
  return {
    admitted: true,
    lifecycleResult,
    timingResult,
    aggregateVersion,
    appliedAggregateVersion,
  };
}
