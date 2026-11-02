/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  registerActiveRun,
  unregisterActiveRun,
  enqueueUserInterjection,
  consumeUserInterjections,
  closeUserInterjectionQueue,
  sealUserInterjectionQueueIfEmpty,
} from "../../ws/chat-websocket/run-registry.js";

function handle() {
  return registerActiveRun({ userId: "state-owner", sessionId: "state-session" });
}

test("registering an existing run preserves pending queue and completion state", () => {
  const run = handle();
  try {
    const queue = run.userInterjectionQueue;
    queue.push({ commandId: "pending" });
    closeUserInterjectionQueue(run);
    assert.equal(registerActiveRun(run), run);
    assert.equal(run.userInterjectionQueue, queue);
    assert.equal(queue.length, 1);
    assert.equal(run.userInterjectionQueueOpen, false);
  } finally {
    unregisterActiveRun(run);
  }
});

test("queue consumers reject damaged state without repairing it or committing authority", () => {
  const invalidFields = {
    userInterjectionQueue: null,
    userInterjectionCommandIds: [],
    userInterjectionQueueOpen: undefined,
    userInterjectionAcceptanceTail: {},
    userInterjectionConsumptionTail: null,
    userInterjectionAcceptanceByCommandId: {},
    userInterjectionPendingAcceptanceCount: -1,
    userInterjectionSequence: 1.5,
  };
  for (const [field, value] of Object.entries(invalidFields)) {
    const run = handle();
    try {
      run[field] = value;
      const before = { ...run };
      let commits = 0;
      const operations = [
        () => registerActiveRun(run),
        () => closeUserInterjectionQueue(run),
        () => sealUserInterjectionQueueIfEmpty(run),
        () => consumeUserInterjections(run, async () => {}),
        () =>
          enqueueUserInterjection(
            run,
            { commandId: "c1", message: "input" },
            async () => commits++,
          ),
      ];
      for (const operation of operations) {
        assert.throws(operation, /invalid_run_interjection_state/);
        assert.deepEqual(run, before);
      }
      assert.equal(commits, 0);
    } finally {
      unregisterActiveRun(run);
    }
  }
});
