/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLinkedAbortScope } from "../linked-abort.js";

test("race resolves with the operation result and dispose releases listeners", async () => {
  const parent = new AbortController();
  const scope = createLinkedAbortScope({ parentSignal: parent.signal });
  assert.equal(await scope.race(Promise.resolve("ok")), "ok");
  scope.dispose();
  parent.abort(new Error("late"));
  assert.equal(scope.signal.aborted, false);
});

test("an already aborted parent rejects the race with the parent reason", async () => {
  const reason = new Error("parent aborted");
  const parent = new AbortController();
  parent.abort(reason);
  const scope = createLinkedAbortScope({ parentSignal: parent.signal });
  assert.equal(scope.signal.aborted, true);
  await assert.rejects(scope.race(new Promise(() => {})), (error) => error === reason);
  scope.dispose();
});

test("a later parent abort propagates to the scope signal", async () => {
  const reason = new Error("parent aborted later");
  const parent = new AbortController();
  const scope = createLinkedAbortScope({ parentSignal: parent.signal });
  const pending = scope.race(new Promise(() => {}));
  parent.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(scope.signal.reason, reason);
  scope.dispose();
});

test("the deadline aborts with the protocol timeout reason", async () => {
  const reason = Object.assign(new Error("timeout"), { code: "TEST_TIMEOUT" });
  const scope = createLinkedAbortScope({ timeoutMs: 5, createTimeoutReason: () => reason });
  await assert.rejects(scope.race(new Promise(() => {})), (error) => error === reason);
  scope.dispose();
});

test("dispose clears the deadline timer", async () => {
  const scope = createLinkedAbortScope({
    timeoutMs: 5,
    createTimeoutReason: () => new Error("timeout"),
  });
  scope.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(scope.signal.aborted, false);
});

test("a deadline without a timeout reason factory is rejected", () => {
  assert.throws(() => createLinkedAbortScope({ timeoutMs: 5 }), TypeError);
});
