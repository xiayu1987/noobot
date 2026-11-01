/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { transitionTurnLifecycle } from "../src/domain/turn-lifecycle-entity.js";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";

const timestamp = "2026-07-30T00:00:00.000Z";
const accepted = {
  eventType: "turn.action_accepted",
  phase: "action",
  action: "send",
  sessionId: "session-1",
  turnScopeId: "turn-1",
  commandId: "command-1",
  causationId: "cause-1",
  presentationMessageId: "message-1",
  dialogProcessId: "dialog-1",
  startedAt: timestamp,
  executionId: "agent:turn-1",
  executionKind: "agent",
  rootExecutionId: "agent:turn-1",
};

test("domain and commit reject undeclared request fields before allocating facts", () => {
  for (const changes of [{ revision: 1 }, { correlationId: "other" }, { extra: undefined }]) {
    const lifecycle = createEmptyTurnLifecycle();
    const before = structuredClone(lifecycle);
    const event = { ...accepted, ...changes };
    const now = () => assert.fail("must not allocate time");
    const results = [
      transitionTurnLifecycle(lifecycle, event, now),
      commitTurnLifecycle({
        lifecycle,
        event,
        now,
        createEventId: () => assert.fail("must not allocate an event"),
        materializeTerminal: () => assert.fail("must not materialize"),
      }),
    ];
    for (const result of results) {
      assert.equal(result.applied, false);
      assert.equal(result.reason, "unknown_lifecycle_request_field");
    }
    assert.deepEqual(lifecycle, before);
  }
});

for (const changes of [
  { eventType: " turn.action_accepted" },
  { phase: " action" },
  { presentationMessageId: 3 },
  { dialogProcessId: " dialog-1" },
  { executionId: " agent:turn-1" },
  { executionKind: "AGENT" },
  { stage: null },
  { origin: [] },
  { origin: null },
  { origin: { type: "workflow_node", workflowRunId: "workflow-1" } },
  { continuationSource: [] },
  { failure: {} },
]) {
  test(`request rejects ${JSON.stringify(changes)} before clock or mutation`, () => {
    const lifecycle = createEmptyTurnLifecycle();
    const before = structuredClone(lifecycle);
    const result = transitionTurnLifecycle(lifecycle, { ...accepted, ...changes }, () => {
      assert.fail("invalid requests must not allocate a transition timestamp");
    });
    assert.equal(result.applied, false);
    assert.deepEqual(lifecycle, before);
  });
}

test("later commands obtain ownership from the stored turn and cannot erase it", () => {
  const original = transitionTurnLifecycle(
    createEmptyTurnLifecycle(),
    {
      ...accepted,
      origin: { type: "chat" },
      stage: "processing",
    },
    () => timestamp,
  ).lifecycle;
  const event = {
    eventType: "turn.processing_started",
    phase: "processing",
    turnScopeId: "turn-1",
    commandId: "command-2",
    causationId: "cause-2",
  };
  const next = transitionTurnLifecycle(original, event, () => timestamp);
  assert.equal(next.applied, true);
  assert.deepEqual(next.turn.origin, { type: "chat" });
  assert.equal(next.turn.stage, "processing");
  for (const changes of [
    { origin: {} },
    { stage: "" },
    { executionId: "" },
    { dialogProcessId: "" },
  ]) {
    const before = structuredClone(original);
    const result = transitionTurnLifecycle(original, { ...event, ...changes }, () => timestamp);
    assert.equal(result.applied, false);
    assert.match(result.reason, /identity_conflict/);
    assert.deepEqual(original, before);
  }
});

test("failed request cannot clean malformed failure facts into a valid record", () => {
  const original = transitionTurnLifecycle(
    createEmptyTurnLifecycle(),
    accepted,
    () => timestamp,
  ).lifecycle;
  for (const failure of [
    null,
    {},
    { code: " failed", message: "failed", retryable: false },
    { code: "failed", message: "failed", retryable: "true" },
    { code: "failed", message: "failed", retryable: false, phase: "action" },
  ]) {
    const result = transitionTurnLifecycle(
      original,
      {
        eventType: "turn.failed",
        phase: "action",
        turnScopeId: "turn-1",
        commandId: "failed-1",
        causationId: "cause-1",
        failure,
      },
      () => timestamp,
    );
    assert.equal(result.applied, false);
    assert.equal(result.reason, "turn_failure_incomplete");
  }
});
