/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope } from "@noobot/event-protocol/envelope";
import { getEventFamily } from "@noobot/event-protocol";
import { MESSAGE_REMOVED_FIELD_NAME, createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import {
  compareWorkflowRuntimeFacts,
  createWorkflowRuntimeEnvelope,
  validateWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
  workflowSessionSnapshotEventId,
} from "@noobot/event-protocol/workflow-runtime-event";

test("constructs the canonical workflow snapshot envelope at its producing boundary", () => {
  const envelope = createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId: "root-session",
    turnScopeId: "workflow-node:node-1",
    executionId: "agent:node-1",
    eventId: workflowSessionSnapshotEventId({
      nodeSessionId: "child-session",
      aggregateVersion: 4,
    }),
    workflowRunId: "run-1",
    causality: { correlationId: "run-1" },
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
        activeTurnScopeId: "",
        activeTurn: null,
        recentTerminalTurns: [],
        replacedTurns: [],
        unchanged: false,
        recovery: "none",
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
  assert.equal(envelope.identity.eventId, "workflow-session-snapshot:child-session:4");
});

test("rejects a snapshot whose eventId is not derived from its node session and version", () => {
  const envelope = snapshotWithMessages([]);
  const forged = { ...envelope, identity: { ...envelope.identity, eventId: "snapshot:other:5" } };
  assert.equal(
    validateWorkflowRuntimeEnvelope(forged).errors.includes("invalid_snapshot_event_id"),
    true,
  );
});

test("snapshot eventId factory rejects non-canonical identity", () => {
  assert.throws(
    () => workflowSessionSnapshotEventId({ nodeSessionId: " s ", aggregateVersion: 1 }),
    TypeError,
  );
  assert.throws(
    () => workflowSessionSnapshotEventId({ nodeSessionId: "s", aggregateVersion: 0 }),
    TypeError,
  );
});

function snapshotWithMessages(messages) {
  return createWorkflowRuntimeEnvelope({
    eventType: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    authoritySessionId: "root-session",
    turnScopeId: "workflow-node:node-1",
    executionId: "agent:node-1",
    eventId: workflowSessionSnapshotEventId({
      nodeSessionId: "child-session",
      aggregateVersion: 5,
    }),
    workflowRunId: "run-1",
    causality: { correlationId: "run-1" },
    sequence: 5,
    aggregateVersion: 5,
    occurredAt: "2026-08-19T00:00:00.000Z",
    producer: { type: "service", id: "workflow-session-read-model" },
    payload: {
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      nodeSessionId: "child-session",
      turnScopeId: "workflow-node:node-1",
      messages,
      turnLifecycleSnapshot: createTurnLifecycleSnapshot({
        activeTurnScopeId: "",
        activeTurn: null,
        recentTerminalTurns: [],
        replacedTurns: [],
        unchanged: false,
        recovery: "none",
        commandId: "snapshot:child-session:5",
        sessionId: "child-session",
        sequence: 5,
        generatedAt: "2026-08-19T00:00:00.000Z",
      }),
      turnTimings: [],
    },
  });
}

test("snapshot messages carry the record key and the role view key, never an alias", () => {
  const user = {
    role: "user",
    messageUid: "sm_user",
    userMessageId: "um_1",
  };
  const assistant = {
    role: "assistant",
    messageUid: "sm_ai",
    presentationMessageId: "pm_1",
  };
  assert.equal(snapshotWithMessages([user, assistant]).payload.messages.length, 2);
  for (const message of [
    { role: "assistant", messageUid: "sm_ai" },
    { role: "user", userMessageId: "um_1" },
    { ...user, [MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID]: "um_1" },
    { ...assistant, rawEvents: [] },
    { ...assistant, toolResult: {} },
    { ...assistant, sequenceDomain: "message_event", sequence: 1 },
  ]) {
    assert.throws(() => snapshotWithMessages([message]), /missing_snapshot_message_identity/);
  }
});

test("snapshot messages carry no session ownership; the node session container owns it", () => {
  const base = { role: "user", messageUid: "sm_user", userMessageId: "um_1" };
  for (const sessionId of ["", "child-session", "other-session"]) {
    assert.throws(
      () => snapshotWithMessages([{ ...base, sessionId }]),
      /missing_snapshot_message_identity/,
    );
  }
});

function workflowEnvelope(eventType, payload, envelope) {
  return createEventEnvelope({
    family: "workflow.runtime",
    schemaVersion: getEventFamily("workflow.runtime").schemaVersion,
    identity: {
      eventId: `event-${eventType}`,
      eventType,
      sessionId: envelope.sessionId,
      turnScopeId: envelope.turnScopeId,
      executionId: envelope.executionId,
    },
    causality: { correlationId: payload.workflowRunId },
    ordering: {
      domain: envelope.domain,
      scopeId: payload.workflowRunId,
      sequence: 1,
      revision: envelope.revision,
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
      presentationMessageId: "assistant-1",
      workflowRunId: "run-1",
      workflowPayload: {
        semantic: { nodes: [{ id: "node-1" }], flowtos: [] },
        nodeSessions: [
          {
            nodeExecutionId: "node-1",
            eventId: "workflow_node_state:run-1:node-1:1",
            status: "ready",
            revision: 1,
            sequence: 1,
          },
        ],
      },
    },
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      executionId: "run-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.PLANNING,
    },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope), { valid: true, errors: [] });
});

test("requires canonical workflow execution and turn scope identity", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.PLANNING,
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      presentationMessageId: "assistant-1",
      workflowRunId: "run-1",
      workflowPayload: {
        semantic: { nodes: [{ id: "node-1" }], flowtos: [] },
        nodeSessions: [
          {
            nodeExecutionId: "node-1",
            eventId: "workflow_node_state:run-1:node-1:1",
            status: "ready",
            revision: 1,
            sequence: 1,
          },
        ],
      },
    },
    {
      sessionId: "session-1",
      turnScopeId: " workflow-node:node-1",
      executionId: " run-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.PLANNING,
    },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, [
    "missing_execution_id",
    "invalid_turn_scope_id",
    "turn_scope_identity_mismatch",
  ]);
});

test("rejects cross-domain workflow declarations", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    {
      workflowRunId: "run-1",
      turnScopeId: "workflow-node:node-1",
      status: "running",
    },
    {
      sessionId: "session-1",
      turnScopeId: "workflow-node:node-1",
      executionId: "node-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT,
      revision: 1,
    },
  );
  assert.ok(validateWorkflowRuntimeEnvelope(envelope).errors.includes("sequence_domain_mismatch"));
});

test("node state execution identity lives only on the envelope", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    {
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      turnScopeId: "workflow-node:node-1",
      status: "running",
    },
    {
      sessionId: "session-1",
      turnScopeId: "workflow-node:node-1",
      executionId: "node-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
      revision: 1,
    },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, ["unknown_node_state_field"]);
});

test("rejects node state without a positive ordering revision", () => {
  for (const revision of [undefined, 0, 1.5]) {
    const envelope = workflowEnvelope(
      WORKFLOW_RUNTIME_EVENT.NODE_STATE,
      { workflowRunId: "run-1", turnScopeId: "workflow-node:node-1", status: "running" },
      {
        sessionId: "session-1",
        turnScopeId: "workflow-node:node-1",
        executionId: "node-1",
        domain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
        revision,
      },
    );
    assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, ["invalid_node_revision"]);
  }
});

test("rejects a planning envelope that carries an ordering revision", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.PLANNING,
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      presentationMessageId: "assistant-1",
      workflowRunId: "run-1",
      workflowPayload: {
        semantic: { nodes: [{ id: "node-1" }], flowtos: [] },
        nodeSessions: [
          {
            nodeExecutionId: "node-1",
            eventId: "workflow_node_state:run-1:node-1:1",
            status: "ready",
            revision: 1,
            sequence: 1,
          },
        ],
      },
    },
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      executionId: "run-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.PLANNING,
      revision: 1,
    },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, [
    "planning_revision_forbidden",
  ]);
});

test("rejects a snapshot envelope that carries an ordering revision", () => {
  const envelope = snapshotWithMessages([]);
  const withRevision = { ...envelope, ordering: { ...envelope.ordering, revision: 1 } };
  assert.deepEqual(validateWorkflowRuntimeEnvelope(withRevision).errors, [
    "snapshot_revision_forbidden",
  ]);
});

test("planning nodes live only in workflowPayload and carry only node fact fields", () => {
  const node = {
    nodeExecutionId: "node-1",
    eventId: "workflow_node_state:run-1:node-1:1",
    status: "ready",
    revision: 1,
    sequence: 1,
  };
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.PLANNING,
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      presentationMessageId: "assistant-1",
      workflowRunId: "run-1",
      workflowPayload: { nodeSessions: [{ ...node, stepStatus: "ready" }] },
      nodeSessions: [node],
    },
    {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      executionId: "run-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.PLANNING,
    },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, [
    "unknown_planning_field",
    "invalid_planning_node",
  ]);
});

test("requires authoritative snapshot identity and aggregate version", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    {
      workflowRunId: "run-1",
      turnScopeId: "workflow-node:node-1",
    },
    {
      sessionId: "session-1",
      turnScopeId: "workflow-node:node-1",
      executionId: "agent:node-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT,
    },
  );
  assert.deepEqual(validateWorkflowRuntimeEnvelope(envelope).errors, [
    "missing_snapshot_node_execution",
    "missing_snapshot_node_session",
    "invalid_aggregate_version",
    "invalid_snapshot_messages",
    "invalid_turn_lifecycle_snapshot",
    "invalid_turn_timings",
  ]);
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

test("reports a null turn lifecycle snapshot as a validation error", () => {
  const envelope = workflowEnvelope(
    WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    {
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      nodeSessionId: "child-session",
      turnScopeId: "workflow-node:node-1",
      messages: [],
      turnLifecycleSnapshot: null,
      turnTimings: [],
    },
    {
      sessionId: "root-session",
      turnScopeId: "workflow-node:node-1",
      executionId: "agent:node-1",
      domain: WORKFLOW_SEQUENCE_DOMAIN.SESSION_SNAPSHOT,
    },
  );

  const result = validateWorkflowRuntimeEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_turn_lifecycle_snapshot"));
});

test("freezes errors when the payload is not an object", () => {
  const result = validateWorkflowRuntimeEnvelope({ payload: null });
  assert.deepEqual(result, { valid: false, errors: ["payload_not_object"] });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.errors));
});
