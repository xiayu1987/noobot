/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createScopedSubSessionEventListener } from "../../src/bot/session/detached-subsession-runner.js";

test("createScopedSubSessionEventListener injects child session coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent() {}, forwardEvent: (event) => received.push(event) },
    {
      userId: "u1",
      sessionId: "sub1",
      parentSessionId: "parent1",
      dialogProcessId: "dialog1",
      turnScopeId: "turn1",
    },
  );
  listener.onEvent({ type: "model_delta", data: { content: "x" } });
  assert.deepEqual(received[0].data, { content: "x" });
  assert.deepEqual(received[0].route, {
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    dialogProcessId: "dialog1",
    turnScopeId: "turn1",
  });
});

test("createScopedSubSessionEventListener returns null without a listener", () => {
  assert.equal(createScopedSubSessionEventListener(null, { sessionId: "sub1" }), null);
});

test("createScopedSubSessionEventListener rejects a persistence-owning listener without a forwarding port", () => {
  assert.throws(
    () => createScopedSubSessionEventListener({ onEvent() {} }, { sessionId: "sub1" }),
    /forwardEvent port/,
  );
});

test("createScopedSubSessionEventListener rejects non-object events", () => {
  const listener = createScopedSubSessionEventListener(
    { onEvent() {}, forwardEvent() {} },
    { sessionId: "sub1" },
  );
  assert.throws(() => listener.onEvent(null), /must be an object/);
});
