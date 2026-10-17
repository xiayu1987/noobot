/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { emitEvent, hasEventListener } from "../../src/events/index.js";

test("emitEvent skips an absent listener", () => {
  assert.equal(emitEvent(null, "x", {}), undefined);
  assert.equal(hasEventListener(undefined), false);
});

test("emitEvent forwards to the listener onEvent port", () => {
  const received = [];
  emitEvent({ onEvent: (event) => received.push(event) }, "x", { a: 1 });
  assert.equal(received[0].event, "x");
  assert.deepEqual(received[0].data, { a: 1 });
});

test("emitEvent rejects a listener without an onEvent port", () => {
  assert.throws(() => emitEvent({}, "x", {}), /onEvent port/);
});
