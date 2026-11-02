/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requireInvocationIdentity, MODEL_CONTEXT_SEQUENCE_POLICY } from "../src/index.js";

const identity = Object.freeze({
  requestId: "request",
  invocationId: "invocation",
  sessionId: "session",
  parentSessionId: "",
  dialogProcessId: "dialog",
  turnScopeId: "turn",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
});

test("invocation identity preserves canonical strings and explicit root ownership", () => {
  assert.deepEqual(requireInvocationIdentity(identity), identity);
  assert.ok(Object.isFrozen(requireInvocationIdentity(identity)));
  assert.equal(
    requireInvocationIdentity({ ...identity, parentSessionId: "parent" }).parentSessionId,
    "parent",
  );
});

test("invocation identity rejects malformed facts without coercion or mutation", () => {
  for (const value of [undefined, null, [], 12]) {
    assert.throws(() => requireInvocationIdentity(value), TypeError);
  }
  for (const key of Object.keys(identity).filter((key) => key !== "contextSequencePolicy")) {
    for (const value of [
      undefined,
      null,
      12,
      false,
      {},
      [],
      " padded ",
      ...(key === "parentSessionId" ? [] : [""]),
    ]) {
      const input = { ...identity, [key]: value };
      const before = structuredClone(input);
      assert.throws(() => requireInvocationIdentity(input), TypeError, key);
      assert.deepEqual(input, before);
    }
  }
});
