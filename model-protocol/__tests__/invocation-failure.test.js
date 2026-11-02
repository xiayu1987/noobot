/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyModelFailure,
  projectModelInvocationFailure,
  MODEL_ERROR_KIND,
  ModelProtocolError,
} from "../src/index.js";
const failure = () => ({
  attemptCount: 2,
  code: "LAST",
  kind: MODEL_ERROR_KIND.TIMEOUT,
  classificationError: null,
  failedAttempts: [
    {
      attempt: 1,
      kind: "transport",
      error: { code: "FIRST", kind: MODEL_ERROR_KIND.RATE_LIMIT, classificationError: null },
    },
    {
      attempt: 2,
      kind: "response",
      error: { code: "LAST", kind: MODEL_ERROR_KIND.TIMEOUT, classificationError: null },
    },
  ],
});
test("failure projection preserves independent attempt facts and freezes the result", () => {
  const result = projectModelInvocationFailure(failure());
  assert.deepEqual(
    result.failedAttempts.map(({ error }) => error.code),
    ["FIRST", "LAST"],
  );
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
for (const field of ["code", "kind", "classificationError"]) {
  test(`failure projection rejects missing attempt error.${field}`, () => {
    const input = failure();
    delete input.failedAttempts[0].error[field];
    assert.throws(() => projectModelInvocationFailure(input), TypeError);
  });
}
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
    { kind: original.kind, retryable: false, classificationError: null },
  );
});
test("non-protocol errors carrying kind are classified by the adapter, never self-declared", () => {
  const original = Object.assign(new Error("raw"), {
    kind: MODEL_ERROR_KIND.ABORTED,
    retryable: true,
  });
  const result = classifyModelFailure(original, () => ({
    kind: MODEL_ERROR_KIND.TIMEOUT,
    retryable: false,
  }));
  assert.deepEqual(result, {
    kind: MODEL_ERROR_KIND.TIMEOUT,
    retryable: false,
    classificationError: null,
  });
  assert.ok(Object.isFrozen(result));
});
test("classifier exceptions and invalid classification are explicit non-retryable classification failures", () => {
  const original = new Error("transport");
  for (const classify of [
    () => {
      throw new Error("classifier defect");
    },
    () => ({ retryable: true }),
    () => ({ kind: "invented", retryable: false }),
    () => ({ kind: MODEL_ERROR_KIND.TIMEOUT }),
    () => ({ kind: MODEL_ERROR_KIND.CLASSIFICATION, retryable: false }),
  ]) {
    const result = classifyModelFailure(original, classify);
    assert.equal(result.kind, MODEL_ERROR_KIND.CLASSIFICATION);
    assert.equal(result.retryable, false);
    assert.equal(typeof result.classificationError, "string");
    assert.notEqual(result.classificationError.length, 0);
  }
});
