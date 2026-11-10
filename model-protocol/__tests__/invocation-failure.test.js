/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyModelFailure,
  projectModelAttemptError,
  projectModelInvocationFailure,
  MODEL_ERROR_KIND,
  ModelProtocolError,
} from "../src/index.js";
const attemptError = (code, kind) => ({
  message: `${code} message`,
  code,
  kind,
  classificationError: null,
});
const failure = () => ({
  attemptCount: 2,
  message: "LAST message",
  code: "LAST",
  kind: MODEL_ERROR_KIND.TIMEOUT,
  classificationError: null,
  failedAttempts: [
    {
      attempt: 1,
      kind: "transport",
      error: attemptError("FIRST", MODEL_ERROR_KIND.RATE_LIMIT),
    },
    {
      attempt: 2,
      kind: "response",
      error: attemptError("LAST", MODEL_ERROR_KIND.TIMEOUT),
    },
  ],
});
test("failure projection preserves independent attempt facts and freezes the result", () => {
  const result = projectModelInvocationFailure(failure());
  assert.deepEqual(
    result.failedAttempts.map(({ error }) => error.message),
    ["FIRST message", "LAST message"],
  );
  assert.equal(result.message, "LAST message");
  assert.ok(Object.isFrozen(result.failedAttempts));
  assert.ok(Object.isFrozen(result.failedAttempts[0].error));
});
test("zero-attempt setup failure is valid without a fabricated provider attempt", () => {
  assert.deepEqual(
    projectModelInvocationFailure({ ...failure(), attemptCount: 0, failedAttempts: [] })
      .failedAttempts,
    [],
  );
});
for (const field of ["message", "code", "kind", "classificationError"]) {
  test(`failure projection rejects missing attempt error.${field}`, () => {
    const input = failure();
    delete input.failedAttempts[0].error[field];
    assert.throws(() => projectModelInvocationFailure(input), TypeError);
  });
}
test("failure projection rejects a missing terminal message", () => {
  const input = failure();
  delete input.message;
  assert.throws(() => projectModelInvocationFailure(input), TypeError);
});
test("attempt error projection keeps an empty upstream message and rejects invalid fields", () => {
  const valid = attemptError("E", MODEL_ERROR_KIND.TIMEOUT);
  assert.equal(projectModelAttemptError({ ...valid, message: "" }).message, "");
  for (const change of [{ message: 1 }, { kind: "invented" }, { code: "" }]) {
    assert.throws(() => projectModelAttemptError({ ...valid, ...change }), TypeError);
  }
});
test("failure projection rejects invalid attempt identity and category", () => {
  for (const change of [{ attempt: 0 }, { attempt: 3 }, { kind: "invented" }]) {
    const input = failure();
    Object.assign(input.failedAttempts[0], change);
    assert.throws(() => projectModelInvocationFailure(input), TypeError);
  }
});
test("protocol errors preserve declared classification without consulting adapter internals", () => {
  const original = new ModelProtocolError("invalid terminal");
  assert.deepEqual(
    classifyModelFailure(original, () => {
      throw new Error("must not run");
    }),
    { kind: original.kind, classificationError: null },
  );
});
test("non-protocol errors carrying kind are classified by the adapter, never self-declared", () => {
  const original = Object.assign(new Error("raw"), {
    kind: MODEL_ERROR_KIND.ABORTED,
  });
  const result = classifyModelFailure(original, () => ({
    kind: MODEL_ERROR_KIND.TIMEOUT,
  }));
  assert.deepEqual(result, {
    kind: MODEL_ERROR_KIND.TIMEOUT,
    classificationError: null,
  });
  assert.ok(Object.isFrozen(result));
});
test("classifier exceptions and invalid classification are explicit classification failures", () => {
  const original = new Error("transport");
  for (const classify of [
    () => {
      throw new Error("classifier defect");
    },
    () => ({}),
    () => ({ kind: "invented" }),
    () => ({ kind: MODEL_ERROR_KIND.TIMEOUT, retryAfterMs: -1 }),
    () => ({ kind: MODEL_ERROR_KIND.CLASSIFICATION }),
  ]) {
    const result = classifyModelFailure(original, classify);
    assert.equal(result.kind, MODEL_ERROR_KIND.CLASSIFICATION);
    assert.equal(typeof result.classificationError, "string");
    assert.notEqual(result.classificationError.length, 0);
  }
});
