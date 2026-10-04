/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createMessageQueryHandlers } from "../../ws/chat-websocket/message-query-handlers.js";

function createHarness({ userId = "user-q", recoverTurnFinalize, bot = {} } = {}) {
  const events = [];
  const recoveryCalls = [];
  const orphanCalls = [];
  const handlers = createMessageQueryHandlers({
    state: {},
    authInfo: { userId },
    sendEvent: (event, data) => events.push({ event, data }),
    translateText: (key) => key,
    resolveBot: () => bot,
    canonicalRunOwnerId: userId,
    recoverTurnFinalize: async (request) => {
      recoveryCalls.push(request);
      return recoverTurnFinalize?.(request);
    },
    recoverSnapshotOrphan: async (request) => {
      orphanCalls.push(request);
    },
  });
  return { handlers, events, recoveryCalls, orphanCalls };
}

function command(overrides = {}) {
  return {
    commandId: "cmd-1",
    commandType: "turn.test",
    identity: { sessionId: " session-q ", parentSessionId: " parent-q ", dialogProcessId: "d" },
    options: { terminalLimit: 3, knownSequence: 7 },
    ...overrides,
  };
}

const errorCodes = (events) => events.map(({ data }) => data?.error?.code);

for (const name of ["handleSnapshotGet", "handleFinalize"]) {
  test(`${name} rejects commands without authenticated user`, async () => {
    const { handlers, events, recoveryCalls } = createHarness({ userId: "" });
    await handlers[name](command());
    const expected =
      name === "handleSnapshotGet" ? "invalid_snapshot_request" : "invalid_finalize_request";
    assert.deepEqual(errorCodes(events), [expected]);
    assert.equal(recoveryCalls.length, 0);
  });
}

test("handleFinalize passes trimmed identity and reports recovery failure", async () => {
  const { handlers, events, recoveryCalls } = createHarness({
    recoverTurnFinalize: () => ({ recovered: false, reason: "finalize_conflict" }),
  });
  await handlers.handleFinalize(command());
  assert.deepEqual(recoveryCalls, [
    {
      userId: "user-q",
      sessionId: "session-q",
      parentSessionId: "parent-q",
      commandId: "cmd-1",
      terminalLimit: 3,
    },
  ]);
  assert.deepEqual(errorCodes(events), ["finalize_conflict"]);
});

test("handleFinalize falls back to generic failure code", async () => {
  const { handlers, events } = createHarness({ recoverTurnFinalize: () => undefined });
  await handlers.handleFinalize(command());
  assert.deepEqual(errorCodes(events), ["finalize_recovery_failed"]);
});

test("handleSnapshotGet runs both recoveries then reads the snapshot", async () => {
  const reads = [];
  const { handlers, events, recoveryCalls, orphanCalls } = createHarness({
    recoverTurnFinalize: () => ({ recovered: false, reason: "no_recoverable_finalize" }),
    bot: {
      async getTurnLifecycleSnapshot(request) {
        reads.push(request);
        return { found: false };
      },
    },
  });
  await handlers.handleSnapshotGet(command());
  const base = { userId: "user-q", sessionId: "session-q", parentSessionId: "parent-q" };
  assert.deepEqual(recoveryCalls, [{ ...base, commandId: "cmd-1:recovery", terminalLimit: 3 }]);
  assert.deepEqual(orphanCalls, [
    { ...base, commandId: "cmd-1:orphan-recovery", terminalLimit: 3 },
  ]);
  assert.deepEqual(reads, [{ ...base, commandId: "cmd-1", knownSequence: 7, terminalLimit: 3 }]);
  assert.deepEqual(errorCodes(events), ["snapshot_not_found"]);
});

test("handleSnapshotGet stops on recovery failure and missing reader", async () => {
  const failed = createHarness({
    recoverTurnFinalize: () => ({ recovered: false, reason: "finalize_conflict" }),
  });
  await failed.handlers.handleSnapshotGet(command());
  assert.deepEqual(errorCodes(failed.events), ["finalize_conflict"]);
  assert.equal(failed.orphanCalls.length, 0);

  const unavailable = createHarness({ recoverTurnFinalize: () => ({ recovered: true }) });
  await unavailable.handlers.handleSnapshotGet(command());
  assert.deepEqual(errorCodes(unavailable.events), ["lifecycle_snapshot_unavailable"]);
});
