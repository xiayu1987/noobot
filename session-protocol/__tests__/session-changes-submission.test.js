/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  captureSessionTransactionInput,
  createSessionChangesSubmission,
  prepareScopedSessionCommitRequest,
  requirePreparedSessionCommitRequest,
  restoreSessionCommitRequest,
} from "../src/session-changes.js";

const owner = { userId: "u1", sessionId: "s1" };
const request = () => ({
  expectedGeneration: 1,
  operationId: "op-1",
  committedAt: "2026-11-16T00:00:00.000Z",
  changes: { messages: [{ messageUid: "m1", content: "body" }] },
});

test("commit request rejects missing fields, aliases and invalid identities at the protocol boundary", () => {
  const { expectedGeneration, ...valid } = request();
  const prepare = (command) =>
    prepareScopedSessionCommitRequest({ epoch, expectedGeneration }, command);
  assert.equal(prepare(valid).expectedGeneration, expectedGeneration);
  for (const field of Object.keys(valid)) {
    const incomplete = { ...valid };
    delete incomplete[field];
    assert.throws(() => prepare(incomplete), TypeError);
  }
  for (const invalid of [
    null,
    [],
    Object.create(valid),
    { ...valid, generation: expectedGeneration },
    ...[null, 1, "", "a".repeat(1025), "中".repeat(342)].map((operationId) => ({
      ...valid,
      operationId,
    })),
    { ...valid, committedAt: "invalid" },
  ])
    assert.throws(() => prepare(invalid), TypeError);
  assert.throws(
    () => prepareRequest({ ...request(), expectedGeneration: Number.MAX_SAFE_INTEGER + 1 }),
    TypeError,
  );
});

test("operation identities preserve exact text and use a UTF-8 byte limit", () => {
  for (const operationId of [" op-1 ", "a".repeat(1024), "中".repeat(341)]) {
    const value = { ...request(), operationId };
    assert.equal(prepareRequest(value).operationId, operationId);
  }
});

const epoch = "a".repeat(32);

function prepareRequest({ expectedGeneration, ...command } = request()) {
  return prepareScopedSessionCommitRequest({ epoch, expectedGeneration }, command);
}

test("cross-process replay restores the exact prepared envelope without inferring absent fields", () => {
  const prepared = prepareRequest();
  const restored = restoreSessionCommitRequest(JSON.stringify(prepared));
  assert.deepEqual(restored, prepared);
  assert.strictEqual(requirePreparedSessionCommitRequest(restored), restored);
  assert.ok(Object.isFrozen(restored.input.changes.messages[0]));
  const { epoch: originalEpoch, ...noEpoch } = prepared;
  assert.equal(originalEpoch, epoch);
  for (const invalid of [
    request(),
    noEpoch,
    { ...prepared, epoch: "not-an-epoch" },
    { ...prepared, expectedGeneration: -1 },
    { ...prepared, input: { changes: prepared.input.changes } },
    { ...prepared, input: { ...prepared.input, extra: true } },
  ])
    assert.throws(() => restoreSessionCommitRequest(JSON.stringify(invalid)), TypeError);
  assert.throws(() => restoreSessionCommitRequest(prepared), TypeError);
});

test("submission rejects raw requests even when their shape is valid", async () => {
  const submission = createSessionChangesSubmission();
  let commits = 0;
  await assert.rejects(
    submission.submit({
      ...owner,
      prepare: request,
      commit: () => ++commits,
    }),
    /reader-prepared request/,
  );
  assert.equal(commits, 0);
});

test("submission detaches once and retries exactly the prepared request after repeated failures", async () => {
  const submission = createSessionChangesSubmission();
  const source = request();
  const requests = [];
  let prepared = 0;
  const prepare = () => {
    prepared += 1;
    return prepareRequest(source);
  };
  const commit = (value) => {
    requests.push(value);
    assert.ok(Object.isFrozen(value.input.changes.messages[0]));
    if (requests.length <= 2) throw new Error("uncertain");
    return "receipt";
  };
  await assert.rejects(submission.submit({ ...owner, prepare, commit }), /uncertain/);
  source.expectedGeneration = 100;
  source.changes.messages[0].content = "concurrent";
  await assert.rejects(submission.submit({ ...owner, prepare, commit }), /uncertain/);
  assert.equal(await submission.submit({ ...owner, prepare, commit }), "receipt");
  assert.equal(prepared, 1);
  assert.strictEqual(requests[0], requests[1]);
  assert.strictEqual(requests[1], requests[2]);
  const { expectedGeneration, operationId, ...input } = request();
  assert.deepEqual(requests[0], { epoch, expectedGeneration, operationId, input });
});

test("commit and transaction use the same protocol-owned payload without recapturing it", () => {
  const source = request();
  const prepared = prepareRequest(source);
  const { input } = prepared;
  assert.strictEqual(requirePreparedSessionCommitRequest(prepared), prepared);
  assert.strictEqual(captureSessionTransactionInput(input), input);
  assert.throws(
    () => requirePreparedSessionCommitRequest(Object.freeze({ ...prepared })),
    /reader-prepared/,
  );
  source.changes.messages[0].content = "changed";
  assert.equal(input.changes.messages[0].content, "body");
});

test("capture rejects non-data input instead of transforming or invoking it", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  let calls = 0;
  const accessor = {
    get body() {
      calls += 1;
      return "body";
    },
  };
  const hook = {
    toJSON() {
      calls += 1;
      return "body";
    },
  };
  for (const value of [
    new Date(),
    new Map(),
    new Uint8Array(1),
    cyclic,
    accessor,
    hook,
    { value: undefined },
    { value: NaN },
    { value: Infinity },
    new Array(1),
    { [Symbol("hidden")]: true },
    Object.defineProperty({}, "hidden", { value: true }),
  ]) {
    assert.throws(() => prepareRequest({ ...request(), changes: value }), TypeError);
  }
  assert.equal(calls, 0);
});

test("concurrent calls share preparation and commit, and foreign owners are rejected", async () => {
  const submission = createSessionChangesSubmission();
  const release = Promise.withResolvers();
  let commits = 0;
  const payload = { ...owner, prepare: () => release.promise, commit: () => ++commits };
  const first = submission.submit(payload);
  const second = submission.submit(payload);
  assert.strictEqual(first, second);
  assert.throws(() => submission.submit({ ...payload, sessionId: "foreign" }), /ownership/);
  assert.throws(() => submission.submit({ ...payload, userId: "foreign" }), /ownership/);
  release.resolve(prepareRequest());
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(commits, 1);
});

test("preparation failure does not retain an invalid request or invoke commit", async () => {
  const submission = createSessionChangesSubmission();
  let commits = 0;
  const commit = () => ++commits;
  await assert.rejects(
    submission.submit({
      ...owner,
      prepare: () => prepareRequest({ ...request(), expectedGeneration: -1 }),
      commit,
    }),
    { code: "SESSION_COMMIT_INPUT_INVALID" },
  );
  await assert.rejects(
    submission.submit({
      ...owner,
      prepare: () => prepareRequest({ ...request(), changes: { messages: undefined } }),
      commit,
    }),
    TypeError,
  );
  assert.equal(commits, 0);
  assert.equal(await submission.submit({ ...owner, prepare: prepareRequest, commit }), 1);
});
