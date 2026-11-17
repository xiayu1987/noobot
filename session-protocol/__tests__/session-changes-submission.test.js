/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createSessionChangesSubmission } from "../src/session-changes.js";

const owner = { userId: "u1", sessionId: "s1" };
const request = () => ({
  expectedGeneration: 1,
  operationId: "op-1",
  committedAt: "2026-11-16T00:00:00.000Z",
  changes: { messages: [{ messageUid: "m1", content: "body" }] },
});

test("submission detaches once and retries exactly the prepared request after repeated failures", async () => {
  const submission = createSessionChangesSubmission();
  const source = request();
  const requests = [];
  let prepared = 0;
  const prepare = () => {
    prepared += 1;
    return source;
  };
  const commit = (value) => {
    requests.push(value);
    assert.ok(Object.isFrozen(value.changes.messages[0]));
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
  assert.deepEqual(requests[0], request());
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
  release.resolve(request());
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
      prepare: () => ({ ...request(), expectedGeneration: -1 }),
      commit,
    }),
    /complete commit request/,
  );
  assert.equal(commits, 0);
  assert.equal(await submission.submit({ ...owner, prepare: request, commit }), 1);
});
