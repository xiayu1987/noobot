/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { partitionRepositoryPerformanceFixture } from "../helpers/partition-repository-performance-fixture.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { message, scope } from "./partition-session-messages.test-helpers.js";

const selection = { userId: "u1", sessionId: "s1", ...scope, cursor: null, limit: 1 };

test("a cold business thinking page does not scan a long turn or materialize its ordinary bodies", async (t) => {
  const f = await partitionRepositoryPerformanceFixture(t);
  const content = "x".repeat(4 * 1024);
  async function seed(from, to) {
    for (let first = from; first < to; first += 16) {
      await f.commit({
        messages: Array.from({ length: Math.min(16, to - first) }, (_, index) => ({
          ...message("s1", `m${first + index}`),
          content,
        })),
      });
    }
  }
  async function measure(count) {
    await f.reopen();
    const { result, work } = await observeStorageIo(f.scope.sessionDir, () =>
      f.services.session.getSessionThinkingDetail(selection),
    );
    assert.equal(result.messageCount, count);
    assert.deepEqual(
      result.messages.map(({ messageUid }) => messageUid),
      ["m0"],
    );
    assert.ok(result.nextCursor);
    assert.ok(work.readBytes > 0);
    return work.readBytes;
  }
  await seed(0, 16);
  const baseline = await measure(16);
  await seed(16, 1024);
  const grown = await measure(1024);
  assert.ok(grown <= baseline + 32 * 1024, JSON.stringify({ baseline, grown }));
  t.diagnostic(JSON.stringify({ baseline, grown }));
});

test("business thinking pagination retains one partition snapshot across writes and releases at the last page", async (t) => {
  const f = await partitionRepositoryPerformanceFixture(t);
  const { session, repository } = f.services;
  await f.commit({ messages: [message("s1", "m1"), message("s1", "m2")] });
  const first = await session.getSessionThinkingDetail(selection);
  assert.equal(first.messages[0].messageUid, "m1");
  assert.equal(first.messageCount, 2);
  assert.equal(repository.pageSnapshots.entries.size, 1);
  await f.commit({ messages: [message("s1", "m3")] });
  const last = await session.getSessionThinkingDetail({ ...selection, cursor: first.nextCursor });
  assert.equal(last.messages[0].messageUid, "m2");
  assert.equal(last.messageCount, 2);
  assert.equal(last.generation, first.generation);
  assert.equal(last.nextCursor, null);
  assert.equal(repository.pageSnapshots.entries.size, 0);
  await assert.rejects(
    session.getSessionThinkingDetail({ ...selection, cursor: first.nextCursor }),
    {
      code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
    },
  );
  const fresh = await session.getSessionThinkingDetail({ ...selection, limit: 3 });
  assert.equal(fresh.messageCount, 3);
  assert.deepEqual(
    fresh.messages.map((item) => item.messageUid),
    ["m1", "m2", "m3"],
  );
});

test("service close releases an abandoned partition page reader and makes its cursor unavailable after reopen", async (t) => {
  const f = await partitionRepositoryPerformanceFixture(t);
  const previous = f.services;
  await f.commit({ messages: [message("s1", "m1"), message("s1", "m2")] });
  const first = await previous.session.getSessionThinkingDetail(selection);
  const resume = { ...selection, cursor: first.nextCursor };
  assert.equal(previous.repository.pageSnapshots.entries.size, 1);
  await f.reopen();
  const { session, repository } = f.services;
  assert.notEqual(repository, previous.repository);
  assert.equal(previous.repository.pageSnapshots.entries.size, 0);
  await assert.rejects(previous.session.getSessionThinkingDetail(resume), {
    code: "SESSION_READER_CLOSED",
  });
  await assert.rejects(session.getSessionThinkingDetail(resume), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  const fresh = await session.getSessionThinkingDetail({ ...selection, limit: 2 });
  assert.equal(fresh.generation, first.generation);
  assert.deepEqual(
    fresh.messages.map((item) => item.messageUid),
    ["m1", "m2"],
  );
});
