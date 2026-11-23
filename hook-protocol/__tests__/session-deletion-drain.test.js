/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createHookManager, HOOK_OUTCOME_STATUS, HOOK_POINT } from "../src/index.js";

const point = HOOK_POINT.SERVICE.AFTER_SESSION_DELETE;

test(
  "a timed-out deletion hook holds its caller until its writes settle",
  { timeout: 2000 },
  async () => {
    const manager = createHookManager();
    const timedOut = Promise.withResolvers();
    const finishWrite = Promise.withResolvers();
    const events = [];
    manager.on(
      point,
      async (_context, { signal }) => {
        signal.addEventListener("abort", () => timedOut.resolve(signal.reason), { once: true });
        await finishWrite.promise;
        events.push("write settled");
      },
      { id: "test.cleanup", timeoutMs: 10 },
    );

    const result = manager.emit(point).then(
      () => assert.fail("a timed-out hook must not acknowledge deletion"),
      (error) => {
        events.push("caller returned");
        return error;
      },
    );
    try {
      assert.equal((await timedOut.promise).code, "HOOK_TIMEOUT");
      await setImmediate();
      assert.deepEqual(events, []);
    } finally {
      finishWrite.resolve();
    }
    const error = await result;
    assert.equal(error.code, "HOOK_EXECUTION_FAILED");
    assert.equal(error.outcomes[0].status, HOOK_OUTCOME_STATUS.TIMED_OUT);
    assert.deepEqual(events, ["write settled", "caller returned"]);
  },
);

test("a cancelled deletion dispatch never starts a handler that has not been admitted", async () => {
  const manager = createHookManager();
  const reason = new Error("request aborted before dispatch");
  let started = false;
  manager.on(
    point,
    () => {
      started = true;
    },
    { id: "test.cleanup" },
  );
  await assert.rejects(
    manager.emit(point, {}, { signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  );
  assert.equal(started, false);
});

test("deletion rejects one-shot handlers without affecting ordinary one-shot hooks", async () => {
  const manager = createHookManager();
  const id = "test.cleanup";
  const cleanup = () => assert.fail("One-shot cleanup must not be registered");
  assert.throws(() => manager.once(point, cleanup, { id }), /requires replayable handlers/);
  assert.throws(
    () => manager.on(point, cleanup, { id, once: true }),
    /requires replayable handlers/,
  );
  assert.deepEqual(manager.list(point), []);

  const ordinary = HOOK_POINT.AGENT.BEFORE_LLM_CALL;
  let calls = 0;
  manager.once(ordinary, () => calls++, { id });
  await manager.emit(ordinary);
  await manager.emit(ordinary);
  assert.equal(calls, 1);
});
