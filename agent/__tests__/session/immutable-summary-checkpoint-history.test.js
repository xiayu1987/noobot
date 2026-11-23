/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableCheckpointKey } from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import {
  readImmutableCheckpoint,
  readImmutableCheckpointPage,
} from "../../src/session/session-artifact-session/immutable-checkpoint-reader.js";
import { exportImmutableSession } from "../../src/session/session-artifact-session/immutable-session-export.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { fixture, commit, checkpoint } from "./immutable-summary-changes.test-helpers.js";

test("checkpoint history remains pageable beyond the exported retry window and pins its generation", async (t) => {
  const store = await fixture(t);
  const count = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit + 2;
  let pinned;
  for (let revision = 1; revision <= count; revision += 1) {
    await commit(
      store,
      {
        summaryCheckpoints: [
          checkpoint({
            checkpointId: `cp${revision}`,
            expectedCheckpointRevision: revision - 1,
            persistedMessageUids: [],
            summarizedMessageUids: [],
          }),
        ],
      },
      `checkpoint-${revision}`,
    );
    if (revision === 2) pinned = await store.snapshot();
  }
  const snapshot = await store.snapshot();
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  const historical = await readImmutableCheckpoint(reopened, snapshot, "t1", "cp1");
  assert.equal(historical.checkpointRevision, 1);
  assert.equal(await readImmutableCheckpoint(reopened, pinned, "t1", `cp${count}`), null);
  const seen = [];
  let cursor = null;
  let page;
  do {
    page = await readImmutableCheckpointPage({
      store: reopened,
      snapshot,
      turnScopeId: "t1",
      cursor,
      limit: 7,
      maxBytes: 8192,
    });
    assert.equal(page.generation, snapshot.generation);
    assert.ok(page.receipts.length <= 7);
    seen.push(...page.receipts.map((receipt) => receipt.checkpointRevision));
    cursor = page.nextCursor;
  } while (cursor !== null);
  assert.deepEqual(
    seen,
    Array.from({ length: count }, (_, i) => count - i),
  );
  const oldPage = await readImmutableCheckpointPage({
    store: reopened,
    snapshot: pinned,
    turnScopeId: "t1",
    cursor: null,
    limit: 7,
    maxBytes: 8192,
  });
  assert.deepEqual(
    oldPage.receipts.map((receipt) => receipt.checkpointRevision),
    [2, 1],
  );
  assert.equal(oldPage.nextCursor, null);
  const continuation = await readImmutableCheckpointPage({
    store: reopened,
    snapshot: pinned,
    turnScopeId: "t1",
    cursor: null,
    limit: 1,
    maxBytes: 4096,
  });
  const readNext = (overrides) =>
    readImmutableCheckpointPage({
      store: reopened,
      snapshot: pinned,
      turnScopeId: "t1",
      cursor: continuation.nextCursor,
      limit: 1,
      maxBytes: 4096,
      ...overrides,
    });
  for (const overrides of [
    { snapshot },
    { turnScopeId: "other" },
    { snapshot: { ...pinned, sessionId: "other" } },
    { snapshot: { ...pinned, commit: "other" } },
  ])
    await assert.rejects(readNext(overrides), TypeError);
  assert.deepEqual(
    (await readNext({})).receipts.map((r) => r.checkpointRevision),
    [1],
  );
  const exported = await exportImmutableSession({ store: reopened, snapshot });
  assert.equal(exported.turnSummaryCheckpoints.t1.receipts.length, count - 2);
  assert.equal(exported.turnSummaryCheckpoints.t1.receipts[0].checkpointId, "cp3");
  assert.equal(exported.turnSummaryCheckpoints.t1.checkpointRevision, count);
});

test("checkpoint pagination bounds gaps and validates cursors and dangling order entries", async (t) => {
  const store = await fixture(t);
  for (let revision = 1; revision <= 3; revision += 1) {
    await commit(
      store,
      {
        summaryCheckpoints: [
          checkpoint({
            checkpointId: `cp${revision}`,
            expectedCheckpointRevision: revision - 1,
            persistedMessageUids: [],
            summarizedMessageUids: [],
          }),
        ],
      },
      `checkpoint-${revision}`,
    );
  }
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "legacy-gap",
    changes: [
      {
        collection: "checkpointOrder",
        key: immutableCheckpointKey("t1", immutableOrderKey(1)),
        remove: true,
      },
    ],
  });
  const snapshot = await store.snapshot();
  const readPage = (options = {}) =>
    readImmutableCheckpointPage({
      store,
      snapshot,
      turnScopeId: "t1",
      cursor: null,
      limit: 1,
      maxBytes: 4096,
      ...options,
    });
  const first = await readPage();
  assert.equal(first.receipts[0].checkpointId, "cp3");
  const second = await readPage({ cursor: first.nextCursor });
  assert.equal(second.receipts[0].checkpointId, "cp2");
  assert.deepEqual(await readPage({ cursor: second.nextCursor }), {
    generation: snapshot.generation,
    receipts: [],
    nextCursor: null,
  });
  assert.equal(await readPage({ turnScopeId: "missing" }), null);
  for (const options of [
    { after: 0 },
    { cursor: 1 },
    { cursor: undefined },
    { limit: 0 },
    { cursor: { ...first.nextCursor, revision: 99 } },
  ])
    await assert.rejects(readPage(options), TypeError);
  await assert.rejects(readPage({ limit: 257 }), { code: "SESSION_QUERY_BUDGET" });
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "dangling-order",
    changes: [
      {
        collection: "checkpointOrder",
        key: immutableCheckpointKey("t1", immutableOrderKey(2)),
        value: "missing",
      },
    ],
  });
  await assert.rejects(readPage({ snapshot: await store.snapshot(), limit: 2 }), /invalid receipt/);
});
