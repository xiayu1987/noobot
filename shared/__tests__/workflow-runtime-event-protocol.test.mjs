/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareWorkflowRuntimeFacts,
  normalizeWorkflowRuntimeEvent,
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
  workflowRuntimeEventComparable,
} from "../workflow-runtime-event-protocol.mjs";

test("canonicalizes every turn-scoped workflow snapshot fact", () => {
  const normalized = normalizeWorkflowRuntimeEvent({
    event: "workflow_session_snapshot_loaded",
    data: {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      aggregateVersion: 1,
      turnStatuses: [{ turnScopeId: "workflow-node_node-1", status: "completed" }],
      turnTimings: [{ turnScopeId: "workflow-node_node-1", thinkingStartedAt: "2026-01-01T00:00:00.000Z" }],
      messages: [{ id: "message-1", turnScopeId: "workflow-node_node-1" }],
    },
  });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.data.turnStatuses[0].turnScopeId, "workflow-node:node-1");
  assert.equal(normalized.data.turnTimings[0].turnScopeId, "workflow-node:node-1");
  assert.equal(normalized.data.messages[0].turnScopeId, "workflow-node:node-1");
});

test("normalizes workflow node state without borrowing transport sequence", () => {
  const event = normalizeWorkflowRuntimeEvent({
    event: "workflow_node_state_committed",
    transportSequence: 900,
    data: { workflowRunId: "run-1", nodeExecutionId: "node-1", sequence: 3, revision: 2 },
  }, { source: "live" });

  assert.equal(event.valid, true);
  assert.equal(event.event, WORKFLOW_RUNTIME_EVENT.NODE_STATE);
  assert.equal(event.sequenceDomain, WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE);
  assert.equal(event.sequence, 3);
  assert.equal(event.transportSequence, 900);
});

test("rejects explicit cross-domain sequence declarations", () => {
  const event = normalizeWorkflowRuntimeEvent({
    event: "workflow_node_state_committed",
    data: { sequence: 3, sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.TRANSPORT },
  });
  assert.equal(event.valid, false);
  assert.deepEqual(event.errors, ["sequence_domain_mismatch"]);
});

test("planning node facts receive node-state domain while planning stays unordered", () => {
  const event = normalizeWorkflowRuntimeEvent({
    event: "workflow_planning_message_prepared",
    data: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      presentationMessageId: "assistant-1",
      workflowRunId: "run-1",
      workflowPayload: {
        workflowRunId: "run-1",
        semantic: { nodes: [{ id: "node-1" }], flowtos: [] },
      },
      nodeSessions: [{ nodeExecutionId: "node-1", sequence: 1 }],
    },
  });
  assert.equal(event.valid, true);
  assert.equal(event.sequence, 0);
  assert.equal(event.sequenceDomain, WORKFLOW_SEQUENCE_DOMAIN.PLANNING);
  assert.equal(event.data.nodeSessions[0].sequenceDomain, WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE);
});

test("rejects planning events without authoritative presentation ownership", () => {
  const event = normalizeWorkflowRuntimeEvent({
    event: WORKFLOW_RUNTIME_EVENT.PLANNING,
    data: { workflowRunId: "run-1", nodeSessions: [{ nodeExecutionId: "node-1" }] },
  });
  assert.deepEqual(event.errors, [
    "missing_planning_session",
    "missing_planning_turn_scope",
    "missing_planning_presentation",
    "missing_planning_workflow_payload",
  ]);
});

test("requires an authoritative version for workflow session snapshots", () => {
  const missingVersion = normalizeWorkflowRuntimeEvent({
    event: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    data: { sessionId: "node-session-1", messages: [] },
  });
  assert.equal(missingVersion.valid, false);
  assert.deepEqual(missingVersion.errors, [
    "missing_snapshot_workflow_run",
    "missing_snapshot_node_execution",
    "missing_snapshot_parent_session",
    "invalid_aggregate_version",
  ]);
  assert.equal(missingVersion.sequence, 0);

  const versioned = normalizeWorkflowRuntimeEvent({
    event: WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT,
    data: {
      sessionId: "node-session-1",
      parentSessionId: "parent-session-1",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-execution-1",
      aggregateVersion: 7,
      messages: [],
    },
  });
  assert.equal(versioned.valid, true);
  assert.equal(versioned.sequence, 7);
});

test("workflow messages require complete stable node ownership", () => {
  const base = {
    event: WORKFLOW_RUNTIME_EVENT.MESSAGE,
    data: {
      envelopeKind: "noobot.message_event",
      envelopeVersion: 2,
      eventId: "event-1",
      eventType: "llm_delta",
      sessionId: "child-1",
      messageId: "message-1",
      presentationMessageId: "presentation-1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      text: "token",
    },
  };
  assert.deepEqual(normalizeWorkflowRuntimeEvent(base).errors, [
    "missing_message_workflow_run",
    "missing_message_node_execution",
    "missing_message_parent_session",
  ]);
  const complete = normalizeWorkflowRuntimeEvent({
    ...base,
    data: {
      ...base.data,
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      parentSessionId: "root-1",
    },
  });
  assert.equal(complete.valid, true);
});

test("events from different sequence domains are never comparable", () => {
  assert.equal(workflowRuntimeEventComparable(
    { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE },
    { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE },
  ), false);
});

test("orders facts only inside one explicit sequence domain", () => {
  assert.deepEqual(compareWorkflowRuntimeFacts(
    { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE, revision: 2, sequence: 1 },
    { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE, revision: 1, sequence: 999 },
  ), {
    comparable: true,
    order: 1,
    incomingDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE,
    currentDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE,
  });
  assert.equal(compareWorkflowRuntimeFacts(
    { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.MESSAGE, sequence: 999 },
    { sequenceDomain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE, sequence: 1 },
  ).comparable, false);
});
