/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
} from "@noobot/event-protocol/workflow-runtime-event";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";

const FIXTURE_OCCURRED_AT = "2026-01-01T00:00:00.000Z";
const FIXTURE_PRODUCER = Object.freeze({ type: "test", id: "client-workflow-runtime-fixture" });
const FIXTURE_ENVELOPE_DEFAULTS = Object.freeze({
  authoritySessionId: "main-session-1",
  workflowRunId: "workflow-1",
  turnScopeId: "workflow-node:node-1",
  sequence: 1,
  occurredAt: FIXTURE_OCCURRED_AT,
});
const ORDERING_DEFAULTS = Object.freeze({
  [WORKFLOW_RUNTIME_EVENT.PLANNING]: Object.freeze({ revision: 1 }),
  [WORKFLOW_RUNTIME_EVENT.NODE_STATE]: Object.freeze({ revision: 1 }),
  [WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT]: Object.freeze({ aggregateVersion: 1 }),
});

export function canonicalWorkflowRuntimeEvent(eventType, data) {
  const {
    eventId,
    executionId,
    authoritySessionId,
    workflowRunId,
    turnScopeId,
    sequence,
    revision,
    aggregateVersion,
    occurredAt,
    ...payloadFields
  } = { ...FIXTURE_ENVELOPE_DEFAULTS, ...ORDERING_DEFAULTS[eventType], ...data };
  return createWorkflowRuntimeEnvelope({
    eventType,
    authoritySessionId,
    turnScopeId,
    executionId,
    eventId,
    workflowRunId,
    sequence,
    revision,
    aggregateVersion,
    occurredAt,
    producer: FIXTURE_PRODUCER,
    causality: {},
    payload: { ...payloadFields, workflowRunId, turnScopeId },
  });
}

export function canonicalWorkflowNodeStateEvent({ nodeExecutionId, ...nodeRecord }) {
  return canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
    nodeSessionId: "sub-session-1",
    ...nodeRecord,
    executionId: nodeExecutionId,
  });
}

export function canonicalWorkflowSessionSnapshot({ nodeSessionId, ...snapshotFields }) {
  const aggregateVersion = snapshotFields.aggregateVersion ?? 1;
  return canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT, {
    turnTimings: [],
    turnLifecycleSnapshot: createTurnLifecycleSnapshot({
      commandId: "test-snapshot-command",
      sessionId: nodeSessionId,
      sequence: aggregateVersion,
      generatedAt: FIXTURE_OCCURRED_AT,
    }),
    ...snapshotFields,
    nodeSessionId,
  });
}
