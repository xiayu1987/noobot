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
    data: { workflowRunId: "run-1", nodeSessions: [{ nodeExecutionId: "node-1", sequence: 1 }] },
  });
  assert.equal(event.sequence, 0);
  assert.equal(event.sequenceDomain, WORKFLOW_SEQUENCE_DOMAIN.PLANNING);
  assert.equal(event.data.nodeSessions[0].sequenceDomain, WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE);
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
