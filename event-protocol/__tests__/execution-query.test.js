/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  deriveAgentExecutionId,
} from "@noobot/session-protocol";
import {
  EVENT_FAMILY,
  EXECUTION_QUERY_FAMILY,
  createExecutionQueryEnvelope,
  validateExecutionQueryEnvelope,
  validateExecutionQueryPayload,
  validateProtocolEvent,
} from "../src/index.js";

function agentExecution(turnScopeId, parent = null) {
  const executionId = deriveAgentExecutionId({ turnScopeId });
  return {
    executionId,
    executionKind: "agent",
    parentExecutionId: parent?.executionId || "",
    rootExecutionId: parent?.rootExecutionId || executionId,
    sessionId: parent ? "session-child" : "session-root",
    turnScopeId,
    sequence: 3,
    revision: 5,
  };
}

const root = agentExecution("turn-root");
const child = agentExecution("turn-child", root);
const occurredAt = "2026-10-17T00:00:00.000Z";

function build(wireEvent, payload, executionId = root.executionId) {
  return createExecutionQueryEnvelope({
    wireEvent,
    commandId: "cmd-1",
    executionId,
    payload,
    occurredAt,
  });
}

const treePayload = {
  rootExecutionId: root.executionId,
  tree: { executions: { [root.executionId]: root, [child.executionId]: child } },
};

test("registry families reference execution query family constants", () => {
  assert.equal(EVENT_FAMILY.EXECUTION_SNAPSHOT, EXECUTION_QUERY_FAMILY.SNAPSHOT);
  assert.equal(EVENT_FAMILY.EXECUTION_CHILDREN, EXECUTION_QUERY_FAMILY.CHILDREN);
  assert.equal(EVENT_FAMILY.EXECUTION_TREE, EXECUTION_QUERY_FAMILY.TREE);
});

test("builds valid envelopes for all three wire events", () => {
  for (const envelope of [
    build(EXECUTION_SNAPSHOT_WIRE_EVENT, { execution: root }),
    build(EXECUTION_CHILDREN_WIRE_EVENT, { execution: root, children: [child] }),
    build(EXECUTION_TREE_WIRE_EVENT, treePayload, child.executionId),
  ]) {
    assert.equal(envelope.causality.commandId, "cmd-1");
    assert.equal(envelope.ordering.domain, "execution");
    assert.equal(envelope.ordering.scopeId, root.executionId);
    assert.deepEqual(validateExecutionQueryEnvelope(envelope).errors, []);
    assert.equal(validateProtocolEvent(envelope).valid, true);
  }
});

test("tree envelope stays valid after JSON round trip", () => {
  const envelope = build(EXECUTION_TREE_WIRE_EVENT, treePayload, child.executionId);
  const wire = JSON.parse(JSON.stringify(envelope));
  assert.deepEqual(validateExecutionQueryEnvelope(wire).errors, []);
  assert.equal(validateProtocolEvent(wire).valid, true);
});

test("rejects unknown payload fields per wire event", () => {
  assert.deepEqual(
    validateExecutionQueryPayload(EXECUTION_SNAPSHOT_WIRE_EVENT, { execution: root, found: true })
      .errors,
    ["unknown_field:found"],
  );
  assert.deepEqual(
    validateExecutionQueryPayload(EXECUTION_TREE_WIRE_EVENT, {
      ...treePayload,
      execution: root,
    }).errors,
    ["unknown_field:execution"],
  );
  assert.deepEqual(
    validateExecutionQueryPayload(EXECUTION_CHILDREN_WIRE_EVENT, {
      execution: root,
      children: [child],
      removedExecutions: [],
    }).errors,
    ["unknown_field:removedExecutions"],
  );
});

test("rejects tree key mismatch and root conflict", () => {
  const other = agentExecution("turn-other");
  const errors = validateExecutionQueryPayload(EXECUTION_TREE_WIRE_EVENT, {
    rootExecutionId: root.executionId,
    tree: { executions: { wrong: root, [other.executionId]: other } },
  }).errors;
  assert.ok(errors.includes("tree_key_mismatch:wrong"));
  assert.ok(errors.includes(`tree_root_conflict:${other.executionId}`));
});

test("rejects children whose parent is not the focus execution", () => {
  const stranger = agentExecution("turn-stranger");
  assert.deepEqual(
    validateExecutionQueryPayload(EXECUTION_CHILDREN_WIRE_EVENT, {
      execution: root,
      children: [stranger],
    }).errors,
    ["child_parent_mismatch:0"],
  );
});

test("rejects envelope causality, ordering and focus violations", () => {
  const valid = build(EXECUTION_SNAPSHOT_WIRE_EVENT, { execution: root });
  const cases = [
    [{ ...valid, causality: {} }, "missing_command_id"],
    [{ ...valid, ordering: { ...valid.ordering, domain: "turn" } }, "sequence_domain_mismatch"],
    [{ ...valid, ordering: { ...valid.ordering, scopeId: "x" } }, "sequence_scope_mismatch"],
    [{ ...valid, ordering: { ...valid.ordering, sequence: 9 } }, "execution_sequence_mismatch"],
    [{ ...valid, identity: { ...valid.identity, sessionId: "x" } }, "execution_session_mismatch"],
    [
      { ...valid, protocol: { ...valid.protocol, family: EXECUTION_QUERY_FAMILY.TREE } },
      "execution_query_family_mismatch",
    ],
  ];
  for (const [envelope, error] of cases) {
    assert.ok(validateExecutionQueryEnvelope(envelope).errors.includes(error), error);
  }
});

test("builder rejects missing focus execution", () => {
  assert.throws(
    () => build(EXECUTION_TREE_WIRE_EVENT, treePayload, "agent:missing"),
    /execution_focus_missing/,
  );
});

test("builder rejects execution sequence below 1", () => {
  assert.throws(
    () => build(EXECUTION_SNAPSHOT_WIRE_EVENT, { execution: { ...root, sequence: 0 } }),
    /invalid_execution_sequence/,
  );
});
