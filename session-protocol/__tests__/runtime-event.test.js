/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_RUN_EVENT,
  createLocalSessionRunEvent,
  projectSessionRunEvent,
  projectTurnLifecycleRuntimeEvent,
} from "@noobot/session-protocol/runtime-event";
import { TURN_TERMINAL_STATES } from "@noobot/session-protocol";

const authoritative = () => ({
  type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
  sessionId: "session-1",
  turnScopeId: "turn-1",
  dialogProcessId: "dialog-1",
  state: "processing",
  seq: 2,
  revision: 2,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("authoritative projection is deterministic, pure and ignores unrelated clock aliases", () => {
  const input = Object.freeze({ ...authoritative(), timestamp: 9, createdAtMs: 100 });
  const before = structuredClone(input);
  const first = projectSessionRunEvent(input);
  assert.equal(first.timestamp, 1767225600000);
  assert.deepEqual(projectSessionRunEvent(input), first);
  assert.deepEqual(input, before);
});

for (const field of [
  "sessionId",
  "turnScopeId",
  "dialogProcessId",
  "updatedAt",
  "revision",
  "seq",
  "state",
]) {
  test(`authoritative projection rejects missing ${field}`, () => {
    const input = authoritative();
    delete input[field];
    assert.throws(() => projectSessionRunEvent(input));
  });
}
for (const [field, value] of [
  ["sessionId", " session-1 "],
  ["dialogProcessId", 123],
  ["turnScopeId", " turn-1 "],
  ["state", "PROCESSING"],
  ["revision", "2"],
  ["seq", "2"],
  ["seq", 0],
  ["seq", NaN],
  ["seq", Infinity],
  ["seq", 1.5],
  ["seq", Number.MAX_SAFE_INTEGER + 1],
  ["summaryVersion", "1"],
  ["updatedAt", "not-a-time"],
  ["updatedAt", "2026-02-30T00:00:00.000Z"],
  ["updatedAtMs", 1],
  ["authority", "custom"],
]) {
  test(`projection rejects ${field}=${String(value)}`, () => {
    assert.throws(() => projectSessionRunEvent({ ...authoritative(), [field]: value }));
  });
}

test("lifecycle mapping reads sequence once and rejects a conflicting seq copy", () => {
  const { seq, ...input } = authoritative();
  assert.equal(projectTurnLifecycleRuntimeEvent({ ...input, sequence: seq }).lifecycleSeq, seq);
  assert.throws(
    () => projectTurnLifecycleRuntimeEvent({ ...input, sequence: seq, seq: seq + 1 }),
    /runtime_sequence_conflict/,
  );
});

test("transport time and sequence are required without local clock generation", () => {
  const input = {
    type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    state: "sending",
    seq: 1,
    updatedAtMs: 1000,
  };
  assert.equal(projectSessionRunEvent(input).timestamp, 1000);
  assert.equal(projectSessionRunEvent(input).transportSeq, 1);
  assert.equal(projectSessionRunEvent(input).lifecycleSeq, 0);
  for (const field of ["seq", "updatedAtMs"]) {
    const invalid = { ...input };
    delete invalid[field];
    assert.throws(() => projectSessionRunEvent(invalid));
  }
});

test("local event factory requires a producer timestamp and preserves supplied identity", () => {
  const input = {
    type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "dp1",
  };
  assert.throws(() => projectSessionRunEvent(input), /timestamp/);
  const created = createLocalSessionRunEvent(input, 1000);
  assert.deepEqual(created, { ...input, timestamp: 1000 });
  assert.equal(projectSessionRunEvent(created).dialogProcessId, "dp1");
  assert.equal(projectSessionRunEvent(created).timestamp, 1000);
  assert.equal(projectSessionRunEvent(created).lifecycleSeq, 0);
  assert.throws(() => createLocalSessionRunEvent(authoritative(), 1000));
  assert.deepEqual(input, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "dp1",
  });
});

test("unknown event types and nested identity copies cannot enter runtime projection", () => {
  assert.throws(() => projectSessionRunEvent({ type: "local_failure" }));
  const input = authoritative();
  delete input.sessionId;
  assert.throws(() => projectSessionRunEvent({ ...input, raw: { sessionId: "s1" } }));
});

for (const state of TURN_TERMINAL_STATES) {
  test(`terminal authoritative state ${state} requires the Authority finishedAt`, () => {
    assert.throws(
      () => projectSessionRunEvent({ ...authoritative(), state }),
      /missing_runtime_terminal_finishedAt/,
    );
    const finishedAt = "2026-01-01T00:00:07.000Z";
    assert.equal(
      projectSessionRunEvent({ ...authoritative(), state, finishedAt }).finishedAt,
      finishedAt,
    );
  });
}

for (const field of ["startedAt", "finishedAt", "thinkingFinishedAt"]) {
  test(`non-authoritative events cannot carry ${field}`, () => {
    const local = createLocalSessionRunEvent(
      { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, turnScopeId: "t1" },
      1000,
    );
    assert.throws(
      () => projectSessionRunEvent({ ...local, [field]: "2026-01-01T00:00:00.000Z" }),
      new RegExp(`runtime_${field}_requires_authority`),
    );
    const transport = {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      seq: 1,
      updatedAtMs: 1000,
      [field]: "2026-01-01T00:00:00.000Z",
    };
    assert.throws(
      () => projectSessionRunEvent(transport),
      new RegExp(`runtime_${field}_requires_authority`),
    );
  });
}
