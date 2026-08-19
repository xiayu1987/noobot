/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope } from "@noobot/event-protocol/envelope";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import {
  compareWorkflowRuntimeFacts,
  createWorkflowRuntimeEnvelope,
  validateWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
  workflowRuntimeEventComparable,
} from "@noobot/event-protocol/workflow-runtime-event";

test("constructs the canonical workflow snapshot envelope at its producing boundary", () => {
  const envelope = createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId: "root-session",
    turnScopeId: "workflow-node:node-1",
    executionId: "agent:node-1",
    eventId: "snapshot:child-session:4",
    workflowRunId: "run-1",
    sequence: 4,
    aggregateVersion: 4,
    occurredAt: "2026-08-19T00:00:00.000Z",
    producer: { type: "service", id: "workflow-session-read-model" },
    payload: {
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      nodeSessionId: "child-session",
      turnScopeId: "workflow-node:node-1",
      messages: [],
      turnLifecycleSnapshot: createTurnLifecycleSnapshot({
        commandId: "snapshot:child-session:4",
        sessionId: "child-session",
        sequence: 4,
        generatedAt: "2026-08-19T00:00:00.000Z",
      }),
      turnTimings: [],
    },
  });

  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope), { valid: true, errors: [] });
  assert.equal(envelope.identity.sessionId, "root-session");
  assert.equal(envelope.ordering.domain, WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT);
  assert.equal(envelope.ordering.aggregateVersion, 4);
});

function workflowEnvelope(eventType, payload, ordering = {}) {
  return createEventEnvelope({
    family: "workflow.runtime",
    identity: {
      eventId: `event-${eventType}`,
      eventType,
      sessionId: ordering.authoritySessionId || payload.sessionId,
      turnScopeId: payload.turnScopeId,
      messageId: payload.messageId,
      executionId: payload.nodeExecutionId,
    },
    causality: { correlationId: payload.workflowRunId },
    ordering: {
      domain: ordering.domain,
      scopeId: payload.workflowRunId,
      sequence: ordering.sequence || 1,
      revision: ordering.revision,
      aggregateVersion: ordering.aggregateVersion,
    },
    producer: { type: "plugin", id: "workflow" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
  });
}

test("validates canonical planning envelope with explicit ownership", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.PLANNING,
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      messageId: "message-1",
      presentationMessageId: "assistant-1",
      workflowRunId: "run-1",
      workflowPayload: { semantic: { nodes: [{ id: "node-1" }], flowtos: [] } },
      nodeSessions: [{ nodeExecutionId: "node-1" }],
    },
    { domain: WORKFLOW_SEQUENCE_DOMAIN.PLANNING },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope), { valid: true, errors: [] });
});

test("rejects cross-domain workflow declarations", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    {
      sessionId: "session-1",
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      status: "running",
    },
    { domain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT, revision: 1 },
  );
  assert.ok(validateWorkflowRuntimeEnvelope(envelope).errors.includes("sequence_domain_mismatch"));
});

test("requires authoritative snapshot identity and aggregate version", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    {
      workflowRunId: "run-1",
      messages: [],
    },
    { domain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT, authoritySessionId: "session-1" },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, [
    "missing_snapshot_node_execution",
    "missing_snapshot_node_session",
    "invalid_aggregate_version",
    "invalid_turn_lifecycle_snapshot",
    "invalid_turn_timings",
  ]);
});

test("events from different sequence domains are never comparable", () => {
  assert.equal(
    workflowRuntimeEventComparable(
      { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE },
      { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT },
    ),
    false,
  );
});

test("orders facts only inside one explicit sequence domain", () => {
  assert.equal(
    compareWorkflowRuntimeFacts(
      { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE, revision: 2, sequence: 1 },
      { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE, revision: 1, sequence: 999 },
    ).order,
    1,
  );
  assert.equal(
    compareWorkflowRuntimeFacts(
      { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT, sequence: 999 },
      { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE, sequence: 1 },
    ).comparable,
    false,
  );
});
