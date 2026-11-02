/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  WORKFLOW_SEQUENCE_DOMAIN,
  admitWorkflowSessionSnapshot,
} from "@noobot/event-protocol/workflow-runtime-event";
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

export function evaluateSubSessionSnapshotAdmission({
  snapshot,
  current,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
}) {
  const appliedAggregateVersion =
    current.sequenceByDomain[WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT];
  const admission = admitWorkflowSessionSnapshot({
    snapshot,
    appliedAggregateVersion,
    applyTurnLifecycleSnapshot,
    applyTurnTimingSnapshot,
  });
  if (admission.admitted) return admission;
  const { reason, lifecycleResult } = admission;
  if (lifecycleResult) {
    return {
      admitted: false,
      result: { applied: false, reason, lifecycleResult },
    };
  }
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
