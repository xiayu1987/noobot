/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import {
  WORKFLOW_RUNTIME_EVENT,
  workflowSequenceDomainForEvent,
} from "@noobot/event-protocol/workflow-runtime-event";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";

const ENVELOPE_FIELDS = new Set([
  "aggregateVersion",
  "authoritySessionId",
  "eventId",
  "messageId",
  "parentSessionId",
  "revision",
  "sequence",
  "sequenceDomain",
  "sessionId",
]);

/**
 * Constructs the sole Workflow Runtime wire contract used by client tests.
 * Domain identities are deliberately moved to their canonical owners instead
 * of being duplicated inside payload.
 */
export function canonicalWorkflowRuntimeEvent(eventType, data = {}) {
  const workflowRunId = String(
    Object.hasOwn(data, "workflowRunId") ? data.workflowRunId : "workflow-1",
  ).trim();
  const nodeSessionId = String(
    Object.hasOwn(data, "nodeSessionId")
      ? data.nodeSessionId
      : Object.hasOwn(data, "sessionId")
        ? data.sessionId
        : "sub-session-1",
  ).trim();
  const authoritySessionId = String(
    data.authoritySessionId ||
      data.parentSessionId ||
      (eventType === WORKFLOW_RUNTIME_EVENT.PLANNING ? data.sessionId : "") ||
      "main-session-1",
  ).trim();
  const sequence = Number(data.sequence || 1);
  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    if (!ENVELOPE_FIELDS.has(key)) payload[key] = value;
  }
  payload.workflowRunId = workflowRunId;
  if (eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT) {
    payload.nodeSessionId = nodeSessionId;
  }
  if (eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE && !payload.nodeSessionId) {
    payload.nodeSessionId = nodeSessionId;
  }

  return createEventEnvelope({
    family: EVENT_FAMILY.WORKFLOW_RUNTIME,
    identity: {
      eventId: String(data.eventId || `${workflowRunId}:${eventType}:${sequence}`).trim(),
      eventType,
      sessionId: authoritySessionId,
      turnScopeId: String(
        Object.hasOwn(data, "turnScopeId")
          ? data.turnScopeId
          : `workflow-node:${data.nodeExecutionId || "node-1"}`,
      ).trim(),
      ...(eventType === WORKFLOW_RUNTIME_EVENT.PLANNING
        ? {
            messageId: String(
              data.messageId || data.presentationMessageId || "workflow-message-1",
            ).trim(),
          }
        : {}),
    },
    causality: {},
    ordering: {
      domain: workflowSequenceDomainForEvent(eventType),
      scopeId: workflowRunId,
      sequence,
      ...(eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE
        ? { revision: Number(data.revision || 1) }
        : {}),
      ...(eventType === WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT
        ? { aggregateVersion: Number(data.aggregateVersion || 1) }
        : {}),
    },
    producer: { type: "test", id: "client-workflow-runtime-fixture" },
    occurredAt: String(data.occurredAt || "2026-01-01T00:00:00.000Z"),
    payload,
  });
}

export function canonicalWorkflowSessionSnapshot(sessionDoc = {}) {
  const sessionId = String(sessionDoc.sessionId || "sub-session-1").trim();
  const aggregateVersion = Number(sessionDoc.aggregateVersion || 1);
  return canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT, {
    ...sessionDoc,
    turnLifecycleSnapshot:
      sessionDoc.turnLifecycleSnapshot ||
      createTurnLifecycleSnapshot({
        commandId: `test-snapshot:${sessionId}:${aggregateVersion}`,
        sessionId,
        sequence: aggregateVersion,
        generatedAt: String(sessionDoc.occurredAt || "2026-01-01T00:00:00.000Z"),
      }),
  });
}
