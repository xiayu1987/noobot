/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSummaryCheckpointPage,
  requireSummaryCheckpointPage,
} from "../src/summary-checkpoint-page.js";

const snapshot = {
  sessionId: "session",
  snapshotId: "epoch",
  generation: 7,
  limits: { pageRecords: 2, pageBytes: 2048 },
};
const options = { turnScopeId: "turn", cursor: null, limit: 1, maxBytes: 2048 };

test("checkpoint pagination binds its continuation to session, snapshot, generation and turn", () => {
  assert.equal(requireSummaryCheckpointPage(snapshot, options), null);
  const page = createSummaryCheckpointPage(snapshot, options, [], 3);
  assert.equal(requireSummaryCheckpointPage(snapshot, { ...options, cursor: page.nextCursor }), 3);
  for (const change of [
    { sessionId: "other" },
    { snapshotId: "other" },
    { generation: 8 },
    { turnScopeId: "other" },
    { revision: 0 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { extra: true },
  ])
    assert.throws(
      () =>
        requireSummaryCheckpointPage(snapshot, {
          ...options,
          cursor: { ...page.nextCursor, ...change },
        }),
      TypeError,
    );
  for (const cursor of [undefined, [], "cursor", {}, { ...page.nextCursor, [Symbol("extra")]: 1 }])
    assert.throws(() => requireSummaryCheckpointPage(snapshot, { ...options, cursor }), TypeError);
  let evaluated = false;
  const cursor = { ...page.nextCursor };
  Object.defineProperty(cursor, "revision", {
    get() {
      evaluated = true;
      return 3;
    },
  });
  assert.throws(() => requireSummaryCheckpointPage(snapshot, { ...options, cursor }), TypeError);
  assert.equal(evaluated, false);
  assert.equal(createSummaryCheckpointPage(snapshot, options, [], null).nextCursor, null);
});

test("checkpoint pagination enforces record and encoded result budgets", () => {
  for (const limit of [0, -1, 1.5, undefined])
    assert.throws(() => requireSummaryCheckpointPage(snapshot, { ...options, limit }), TypeError);
  assert.throws(() => requireSummaryCheckpointPage(snapshot, { ...options, limit: 3 }), {
    code: "SESSION_QUERY_BUDGET",
  });
  assert.throws(
    () => requireSummaryCheckpointPage(snapshot, { ...options, turnScopeId: " turn" }),
    TypeError,
  );
  assert.throws(
    () => createSummaryCheckpointPage(snapshot, options, [{ content: "x".repeat(2048) }], null),
    {
      code: "SESSION_QUERY_BUDGET",
    },
  );
});

test("checkpoint result budget includes UTF-8 receipts and the continuation", () => {
  for (const maxBytes of [0, -1, 1.5, Infinity, undefined])
    assert.throws(
      () => requireSummaryCheckpointPage(snapshot, { ...options, maxBytes }),
      TypeError,
    );
  const receipts = [{ content: "\u00e9" }];
  const page = createSummaryCheckpointPage(snapshot, options, receipts, 3);
  const bytes = Buffer.byteLength(JSON.stringify(page));
  assert.deepEqual(
    createSummaryCheckpointPage(snapshot, { ...options, maxBytes: bytes }, receipts, 3),
    page,
  );
  assert.throws(
    () => createSummaryCheckpointPage(snapshot, { ...options, maxBytes: bytes - 1 }, receipts, 3),
    { code: "SESSION_QUERY_BUDGET" },
  );
});
