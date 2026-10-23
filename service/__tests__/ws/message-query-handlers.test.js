/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol/turn-lifecycle";
import { createMessageQueryHandlers } from "../../ws/chat-websocket/message-query-handlers.js";

function createHarness({ userId = "user-q", readSnapshot, finalize } = {}) {
  const events = [];
  const reads = [];
  const finalizes = [];
  const handlers = createMessageQueryHandlers({
    state: {},
    authInfo: { userId },
    sendEvent: (event, data) => events.push({ event, data }),
    translateText: (key) => key,
    resolveBot: () => ({}),
    canonicalRunOwnerId: userId,
    turnRecovery: {
      readSnapshot: async (request) => {
        reads.push(request);
        return readSnapshot?.(request);
      },
      finalize: async (request) => {
        finalizes.push(request);
        return finalize?.(request);
      },
    },
  });
  return { handlers, events, reads, finalizes };
}

function command(overrides = {}) {
  return {
    commandId: "cmd-1",
    commandType: "turn.test",
    identity: {
      sessionId: "session-q",
      parentSessionId: "parent-q",
      dialogProcessId: "d",
      parentDialogProcessId: "",
      turnScopeId: "",
    },
    options: { terminalLimit: 3, knownSequence: 7 },
    ...overrides,
  };
}

const base = { userId: "user-q", sessionId: "session-q", parentSessionId: "parent-q" };
const errorCodes = (events) => events.map(({ data }) => data?.error?.code);
const snapshot = (overrides = {}) =>
  createTurnLifecycleSnapshot({
    commandId: "cmd-1",
    userId: "user-q",
    sessionId: "session-q",
    generatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  });

for (const name of ["handleSnapshotGet", "handleFinalize"]) {
  test(`${name} rejects commands without authenticated user`, async () => {
    const { handlers, events, reads, finalizes } = createHarness({ userId: "" });
    await handlers[name](command());
    const expected =
      name === "handleSnapshotGet" ? "invalid_snapshot_request" : "invalid_finalize_request";
    assert.deepEqual(errorCodes(events), [expected]);
    assert.equal(reads.length + finalizes.length, 0);
  });
}

test("handleSnapshotGet is a single pure read and never finalizes", async () => {
  const { handlers, events, reads, finalizes } = createHarness({
    readSnapshot: () => ({ found: true, snapshot: snapshot() }),
  });
  await handlers.handleSnapshotGet(command());
  assert.deepEqual(reads, [{ ...base, commandId: "cmd-1", knownSequence: 7, terminalLimit: 3 }]);
  assert.equal(finalizes.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.payload.recovery, "none");
});

test("handleSnapshotGet reports missing snapshots and rejects invalid annotations", async () => {
  const missing = createHarness({
    readSnapshot: () => ({ found: false, reason: "session_not_found" }),
  });
  await missing.handlers.handleSnapshotGet(command());
  assert.deepEqual(errorCodes(missing.events), ["session_not_found"]);

  const invalid = createHarness({
    readSnapshot: () => ({ found: true, snapshot: { ...snapshot(), recovery: "orphan" } }),
  });
  await invalid.handlers.handleSnapshotGet(command());
  assert.deepEqual(errorCodes(invalid.events), ["invalid_authoritative_snapshot"]);
});

test("handleFinalize passes protocol identity and reports recovery failure", async () => {
  const { handlers, events, finalizes } = createHarness({
    finalize: () => ({ recovered: false, reason: "turn_revision_conflict" }),
  });
  await handlers.handleFinalize(command());
  assert.deepEqual(finalizes, [{ ...base, commandId: "cmd-1", terminalLimit: 3 }]);
  assert.deepEqual(errorCodes(events), ["turn_revision_conflict"]);
});

test("handleFinalize forwards the recovery reason and sends the settled snapshot", async () => {
  const failed = createHarness({
    finalize: () => ({ recovered: false, reason: "session_not_found" }),
  });
  await failed.handlers.handleFinalize(command());
  assert.deepEqual(errorCodes(failed.events), ["session_not_found"]);

  const settled = createHarness({
    finalize: () => ({ recovered: true, snapshot: snapshot() }),
  });
  await settled.handlers.handleFinalize(command());
  assert.deepEqual(errorCodes(settled.events), [undefined]);
});
