/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_SEQUENCE_DOMAIN } from "@noobot/event-protocol/workflow-runtime-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";

export function buildSnapshotContextFacet(snapshot) {
  return {
    source: snapshot.source,
    eventId: snapshot.eventId,
    sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT,
    aggregateVersion: snapshot.aggregateVersion,
  };
}

export function buildSubSessionSnapshotRegistryEntry({ current, snapshot, messages }) {
  return {
    ...current,
    sessionId: snapshot.sessionId,
    parentSessionId: snapshot.parentSessionId,
    dialogProcessId: snapshot.dialogProcessId,
    turnScopeId: snapshot.turnScopeId,
    workflowRunId: snapshot.workflowRunId,
    nodeExecutionId: snapshot.nodeExecutionId,
    messages,
    sequenceByDomain: {
      ...current.sequenceByDomain,
      [WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT]: snapshot.aggregateVersion,
    },
    updatedAt: snapshot.occurredAt,
  };
}

function lifecycleRejected(lifecycleResult) {
  return lifecycleResult.applied === false && lifecycleResult.deduplicated !== true;
}

function resolveStaleReason(aggregateVersion, appliedAggregateVersion) {
  return aggregateVersion === appliedAggregateVersion
    ? "duplicate_snapshot_version"
    : "stale_snapshot";
}

export function evaluateSubSessionSnapshotAdmission({
  snapshot,
  current,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
}) {
  const lifecycleResult = applyTurnLifecycleSnapshot(snapshot.turnLifecycleSnapshot);
  if (lifecycleRejected(lifecycleResult)) {
    return {
      admitted: false,
      result: { applied: false, reason: lifecycleResult.reason, lifecycleResult },
    };
  }
  const timingResult = applyTurnTimingSnapshot({
    sessionId: snapshot.sessionId,
    turnTimings: snapshot.turnTimings,
  });
  const { aggregateVersion } = snapshot;
  const appliedAggregateVersion =
    current.sequenceByDomain[WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT];
  if (appliedAggregateVersion !== undefined && aggregateVersion <= appliedAggregateVersion) {
    const reason = resolveStaleReason(aggregateVersion, appliedAggregateVersion);
    logWorkflowDiagnostics("frontend.workflowSubSession.snapshotRejected", () => ({
      sessionId: snapshot.sessionId,
      parentSessionId: snapshot.parentSessionId,
      workflowRunId: snapshot.workflowRunId,
      nodeExecutionId: snapshot.nodeExecutionId,
      appliedAggregateVersion,
      ...buildSnapshotContextFacet(snapshot),
      reason,
    }));
    return { admitted: false, result: { applied: false, reason, current } };
  }
  return { admitted: true, lifecycleResult, timingResult, appliedAggregateVersion };
}
