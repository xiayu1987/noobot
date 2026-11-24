/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { sessionArtifactMethods } from "../../src/session/repositories/file-system-session-repository/artifact-methods.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";

const lookupKey = { dialogProcessId: "dialog", turnScopeId: "turn" };
const message = { sessionId: "session", ...lookupKey, messageUid: "message" };

function fixture(page) {
  const work = { acquisitions: 0, releases: 0, reads: [] };
  const repository = {
    pageSnapshots: new SessionPageSnapshots(),
    async assertSessionWritable() {},
    _sessionPageAccess: sessionArtifactMethods._sessionPageAccess,
    readSessionThinkingDetail: sessionArtifactMethods.readSessionThinkingDetail,
    async requireSessionReader() {
      work.acquisitions += 1;
      return {
        async readThinkingDetailPage(selection) {
          work.reads.push(selection);
          return page;
        },
        async close() {
          work.releases += 1;
        },
      };
    },
  };
  const read = (change) =>
    repository.readSessionThinkingDetail("user", "session", {
      lookupKey,
      cursor: null,
      limit: 1,
      ...change,
    });
  return { work, read };
}

test("thinking page rejects invalid requests before acquiring a storage snapshot", async () => {
  const { work, read } = fixture(null);
  for (const change of [
    { cursor: undefined },
    { cursor: { after: 0, scope: "snapshot" } },
    { cursor: { after: 1, scope: "snapshot", extra: true } },
    { limit: 0 },
    { limit: Infinity },
    { limit: QUANTITY_THRESHOLDS.sessionStorage.messageReadPageSize + 1 },
    { lookupKey: { ...lookupKey, turnScopeId: " turn" } },
  ])
    await assert.rejects(read(change), TypeError);
  assert.deepEqual(work, { acquisitions: 0, releases: 0, reads: [] });
});

test("thinking page applies the same response contract to storage results and releases the reader", async () => {
  const page = { generation: 1, messageCount: 1, records: [{ message }], nextCursor: null };
  const { work, read } = fixture(page);
  assert.deepEqual(await read(), {
    exists: true,
    sessionId: "session",
    ...lookupKey,
    generation: 1,
    messageCount: 1,
    messages: [message],
    nextCursor: null,
  });
  assert.equal(work.acquisitions, 1);
  assert.equal(work.releases, 1);
  for (const invalid of [
    { ...page, generation: 0 },
    { ...page, records: [{ message: { ...message, sessionId: "foreign" } }] },
    { ...page, nextCursor: { after: 1, scope: "snapshot" } },
  ]) {
    const bad = fixture(invalid);
    await assert.rejects(bad.read(), TypeError);
    assert.equal(bad.work.releases, 1);
  }
});

test("thinking page missing data is allowed only for the first page", async () => {
  const { work, read } = fixture(null);
  assert.deepEqual(await read(), { exists: false });
  await assert.rejects(read({ cursor: { after: 1, scope: "snapshot" } }), TypeError);
  assert.equal(work.releases, 1);
});
