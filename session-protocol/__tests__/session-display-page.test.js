/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSessionPageSnapshotCursor } from "@noobot/session-protocol/message-read-budget";
import {
  createSessionDisplayPage,
  createSessionDisplayStats,
  planSessionDisplayPage,
  readSessionDisplayPage,
  requireRetainedSessionDisplayPageResponse,
  requireSessionDisplayPageSelection,
  requireSessionDisplayPageTransition,
} from "@noobot/session-protocol/session-reader";

const scope = {
  sessionId: "child",
  parentSessionId: "root",
  snapshotId: "pin-1",
  generation: 7,
  aggregateVersion: 3,
};
const selection = { cursor: null, direction: "backward", limit: 2, maxBytes: 4096 };
const counts = {
  messageCount: 5,
  displayMessageCount: 3,
  injectedMessageCount: 2,
  thinkingMessageCount: 1,
  toolLogCount: 3,
  displayToolLogCount: 1,
  unassignedToolArtifactCount: 0,
  conflictedToolArtifactCount: 1,
  attachmentCount: 4,
};
const stats = createSessionDisplayStats(counts);
const firstMessage = { messageUid: "m1", contentReference: "v1", contentBytes: 2 };
const window = {
  ...scope,
  after: 1,
  messages: [
    { messageUid: "m2", contentReference: "v2", contentBytes: 6, label: "\u{1F642}" },
    { turnPlaceholder: true, content: "" },
  ],
};
const statistics = { ...scope, stats };
const entry = (row, read = () => row) => ({
  jsonBytes: Buffer.byteLength(JSON.stringify(row)),
  read,
});

test("display continuation counts final rows and preserves global statistics", () => {
  assert.deepEqual(planSessionDisplayPage(scope, selection, statistics), { after: 1, length: 2 });
  assert.deepEqual(
    planSessionDisplayPage(scope, { ...selection, direction: "forward" }, statistics),
    { after: 0, length: 2 },
  );
  const tail = createSessionDisplayPage(scope, selection, { window, statistics });
  assert.deepEqual(
    planSessionDisplayPage(scope, { ...selection, cursor: tail.nextCursor }, statistics),
    { after: 0, length: 1 },
  );
  const head = createSessionDisplayPage(
    scope,
    { ...selection, cursor: tail.nextCursor },
    {
      window: { ...scope, after: 0, messages: [{ messageUid: "m1" }] },
      statistics,
    },
  );
  assert.deepEqual(tail.messages, window.messages);
  assert.equal(tail.nextCursor.after, 2);
  assert.deepEqual(head.messages, [{ messageUid: "m1" }]);
  assert.equal(head.nextCursor, null);
  assert.deepEqual(head.stats, tail.stats);
  assert.deepEqual(head.stats, { ...counts, hasToolDetails: true });
});

test("display reader requests only the planned final row window from its retained source", async () => {
  const calls = [];
  const source = {
    readStatistics(retained) {
      calls.push(["stats", retained]);
      return statistics;
    },
    readWindow(retained, options) {
      calls.push(["window", retained, options]);
      return {
        ...window,
        messages: (async function* () {
          yield* window.messages.map((row) => entry(row));
        })(),
      };
    },
  };
  assert.deepEqual(
    await readSessionDisplayPage(scope, selection, source),
    createSessionDisplayPage(scope, selection, { window, statistics }),
  );
  assert.deepEqual(calls, [
    ["stats", scope],
    ["window", scope, { after: 1, length: 2 }],
  ]);
});

test("display response budget stops pulling rows and closes the retained iterator", async () => {
  const expected = createSessionDisplayPage(scope, selection, { window, statistics });
  const exact = Buffer.byteLength(JSON.stringify(expected));
  let pulled = 0;
  let read = 0;
  let closed = 0;
  const source = {
    readStatistics: () => statistics,
    readWindow: () => ({
      ...window,
      messages: (async function* () {
        try {
          for (const row of window.messages) {
            pulled += 1;
            yield entry(row, () => {
              read += 1;
              return row;
            });
          }
        } finally {
          closed += 1;
        }
      })(),
    }),
  };
  assert.deepEqual(
    await readSessionDisplayPage(scope, { ...selection, maxBytes: exact }, source),
    expected,
  );
  assert.equal(read, 2);
  pulled = 0;
  read = 0;
  await assert.rejects(
    readSessionDisplayPage(
      scope,
      {
        ...selection,
        maxBytes: exact - Buffer.byteLength(JSON.stringify(window.messages[1])) - 2,
      },
      source,
    ),
    { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" },
  );
  assert.equal(pulled, 1);
  assert.equal(read, 0);
  assert.equal(closed, 2);
  pulled = 0;
  await assert.rejects(readSessionDisplayPage(scope, { ...selection, maxBytes: 1 }, source), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  assert.equal(pulled, 0);
  assert.equal(closed, 2);
});

test("invalid display request, mismatched statistics and empty range do not read rows", async () => {
  let statisticReads = 0;
  const source = {
    readStatistics() {
      statisticReads += 1;
      return { ...statistics, generation: 8 };
    },
    readWindow() {
      assert.fail("No window read is permitted");
    },
  };
  await assert.rejects(
    readSessionDisplayPage(scope, { ...selection, direction: "sideways" }, source),
    /direction/,
  );
  assert.equal(statisticReads, 0);
  await assert.rejects(readSessionDisplayPage(scope, selection, source), /retained snapshot/);
  assert.equal(statisticReads, 1);
  const emptyStats = createSessionDisplayStats(
    Object.fromEntries(Object.keys(counts).map((key) => [key, 0])),
  );
  const empty = await readSessionDisplayPage(scope, selection, {
    ...source,
    readStatistics: () => ({ ...scope, stats: emptyStats }),
  });
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.nextCursor, null);
  assert.deepEqual(empty.stats, emptyStats);
});

test("display cursors, rows and statistics cannot cross snapshots", () => {
  const page = createSessionDisplayPage(scope, selection, { window, statistics });
  for (const other of [
    { snapshotId: "pin-2" },
    { generation: 8 },
    { parentSessionId: "elsewhere" },
  ]) {
    assert.throws(
      () =>
        requireSessionDisplayPageSelection(
          { ...scope, ...other },
          {
            ...selection,
            cursor: page.nextCursor,
          },
        ),
      { code: "SESSION_PAGE_CURSOR_CONFLICT" },
    );
  }
  assert.throws(
    () =>
      requireSessionDisplayPageSelection(scope, {
        ...selection,
        direction: "forward",
        cursor: page.nextCursor,
      }),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  assert.throws(
    () =>
      createSessionDisplayPage(scope, selection, {
        window,
        statistics: { ...statistics, generation: 8 },
      }),
    /retained snapshot/,
  );
  assert.throws(
    () =>
      createSessionDisplayPage(scope, selection, {
        window: { ...window, snapshotId: "pin-2" },
        statistics,
      }),
    /retained snapshot/,
  );
  for (const other of [{ sessionId: "other" }, { parentSessionId: "" }]) {
    assert.throws(
      () => planSessionDisplayPage(scope, selection, { ...statistics, ...other }),
      /retained snapshot/,
    );
    assert.throws(
      () =>
        createSessionDisplayPage(scope, selection, { window: { ...window, ...other }, statistics }),
      /retained snapshot/,
    );
  }
});

test("retained display pages require the authoritative aggregate version across continuations", () => {
  const page = createSessionDisplayPage(scope, selection, { window, statistics });
  const previous = {
    ...page,
    nextCursor: encodeSessionPageSnapshotCursor("reader", page.nextCursor),
  };
  const request = { ...selection, sessionId: scope.sessionId, cursor: previous.nextCursor };
  const last = createSessionDisplayPage(
    scope,
    { ...selection, cursor: page.nextCursor },
    {
      window: { ...scope, after: 0, messages: [firstMessage] },
      statistics,
    },
  );
  assert.equal(requireSessionDisplayPageTransition(last, request, previous), last);
  for (const absent of [undefined, null, { ...previous, nextCursor: null }]) {
    assert.throws(
      () => requireSessionDisplayPageTransition(last, request, absent),
      /requires its previous page/,
    );
  }
  for (const invalid of [
    { ...firstMessage, content: "inline" },
    { ...firstMessage, contentReference: null },
    { ...firstMessage, contentBytes: 1 },
    { ...firstMessage, turnPlaceholder: true, content: "" },
  ]) {
    assert.throws(
      () => requireRetainedSessionDisplayPageResponse({ ...last, messages: [invalid] }, request),
      TypeError,
    );
  }
  assert.throws(
    () => requireSessionDisplayPageTransition(last, { ...request, direction: "forward" }, previous),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  assert.throws(
    () => requireRetainedSessionDisplayPageResponse({ ...last, generation: 8 }, request),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  assert.throws(
    () => requireSessionDisplayPageTransition({ ...last, aggregateVersion: 4 }, request, previous),
    /changed its retained snapshot facts/,
  );
  assert.throws(
    () =>
      requireSessionDisplayPageTransition(
        { ...last, aggregateVersion: undefined },
        request,
        previous,
      ),
    /Invalid retained display page identity/,
  );
  assert.throws(
    () =>
      createSessionDisplayPage(scope, selection, {
        window,
        statistics: { ...statistics, aggregateVersion: 4 },
      }),
    /does not belong to the retained snapshot/,
  );
});

test("retained display continuation must consume the previous page's cursor", () => {
  const page = createSessionDisplayPage(scope, selection, { window, statistics });
  const previous = {
    ...page,
    nextCursor: encodeSessionPageSnapshotCursor("reader", page.nextCursor),
  };
  const last = { ...page, messages: [firstMessage], nextCursor: null };
  const request = { ...selection, sessionId: scope.sessionId };
  assert.equal(requireSessionDisplayPageTransition(previous, request, null), previous);
  const cursor = encodeSessionPageSnapshotCursor("other-reader", page.nextCursor);
  assert.throws(
    () => requireSessionDisplayPageTransition(last, { ...request, cursor }, previous),
    /does not continue the previous display page/,
  );
  assert.throws(
    () => requireSessionDisplayPageTransition(previous, request, previous),
    /requires its previous page/,
  );
});

test("retained display continuation compares decoded cursor identity and position", () => {
  const firstSelection = { ...selection, limit: 1 };
  const first = createSessionDisplayPage(scope, firstSelection, {
    window: { ...window, after: 2, messages: [window.messages[1]] },
    statistics,
  });
  const previous = {
    ...first,
    nextCursor: encodeSessionPageSnapshotCursor("reader", first.nextCursor),
  };
  const cursor = {
    ...previous.nextCursor,
    scope: JSON.stringify(JSON.parse(previous.nextCursor.scope), null, 2),
  };
  const request = { ...firstSelection, sessionId: scope.sessionId, cursor };
  const second = createSessionDisplayPage(
    scope,
    { ...firstSelection, cursor: first.nextCursor },
    {
      window: { ...window, messages: [window.messages[0]] },
      statistics,
    },
  );
  const page = {
    ...second,
    nextCursor: encodeSessionPageSnapshotCursor("reader", second.nextCursor),
  };
  assert.equal(requireSessionDisplayPageTransition(page, request, previous), page);
  assert.equal(requireRetainedSessionDisplayPageResponse(page, request), page);
  assert.throws(
    () =>
      requireSessionDisplayPageTransition(
        page,
        {
          ...request,
          cursor: { ...cursor, after: cursor.after + 1 },
        },
        previous,
      ),
    /does not continue the previous display page/,
  );
  assert.throws(
    () =>
      requireRetainedSessionDisplayPageResponse(
        {
          ...page,
          nextCursor: encodeSessionPageSnapshotCursor("other-reader", second.nextCursor),
        },
        request,
      ),
    /Invalid retained display page continuation/,
  );
});

test("retained display response charges the encoded continuation against the request budget", () => {
  const page = createSessionDisplayPage(scope, selection, { window, statistics });
  const retained = {
    ...page,
    nextCursor: encodeSessionPageSnapshotCursor("reader-token", page.nextCursor),
  };
  const request = { ...selection, sessionId: scope.sessionId };
  assert.throws(
    () =>
      requireRetainedSessionDisplayPageResponse({ ...retained, parentSessionId: "other" }, request),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  const coordinates = JSON.parse(page.nextCursor.scope);
  coordinates[2] = null;
  const nextCursor = encodeSessionPageSnapshotCursor("reader-token", {
    after: page.nextCursor.after,
    scope: JSON.stringify(coordinates),
  });
  assert.throws(
    () => requireRetainedSessionDisplayPageResponse({ ...retained, nextCursor }, request),
    { code: "SESSION_PAGE_CURSOR_CONFLICT" },
  );
  const exact = Buffer.byteLength(JSON.stringify(retained));
  assert.ok(exact > Buffer.byteLength(JSON.stringify(page)));
  assert.equal(
    requireRetainedSessionDisplayPageResponse(retained, { ...request, maxBytes: exact }),
    retained,
  );
  assert.throws(
    () => requireRetainedSessionDisplayPageResponse(retained, { ...request, maxBytes: exact - 1 }),
    { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" },
  );
});

test("display page rejects incomplete windows and bounds the full UTF-8 response", () => {
  const page = createSessionDisplayPage(scope, selection, { window, statistics });
  const bytes = Buffer.byteLength(JSON.stringify(page));
  assert.deepEqual(
    createSessionDisplayPage(
      scope,
      { ...selection, maxBytes: bytes },
      {
        window,
        statistics,
      },
    ),
    page,
  );
  assert.throws(
    () =>
      createSessionDisplayPage(
        scope,
        { ...selection, maxBytes: bytes - 1 },
        {
          window,
          statistics,
        },
      ),
    { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" },
  );
  assert.throws(
    () =>
      createSessionDisplayPage(scope, selection, {
        window: { ...window, after: 0 },
        statistics,
      }),
    /mispositioned window/,
  );
  assert.throws(
    () =>
      createSessionDisplayPage(scope, selection, {
        window: { ...window, messages: [] },
        statistics,
      }),
    /incomplete/,
  );
  assert.throws(
    () => createSessionDisplayStats({ ...counts, displayToolLogCount: 3 }),
    /Inconsistent global display counts/,
  );
});
