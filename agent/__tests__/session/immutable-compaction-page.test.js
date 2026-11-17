/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { readImmutableCompactionPage } from "../../src/session/session-artifact-session/immutable-compaction-page.js";
import { openSessionArtifactReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { compactSessionArtifacts } from "../../src/session/session-artifact-maintenance.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import {
  IMMUTABLE_COMPACTION_DISCOVERY as DISCOVERY,
  IMMUTABLE_COMPACTION_BUDGET as BUDGET,
  requireImmutableCompactionRecords,
} from "@noobot/session-protocol/immutable-record-location";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "compaction-discovery-"));
  const resources = new AsyncDisposableStack();
  t.after(() => resources.disposeAsync());
  resources.defer(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "discovery",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "metadata", key: "session", value: { sessionId: "discovery" } },
      ...Array.from({ length: 150 }, (_, i) => ({
        collection: "metadata",
        key: `item-${i}`,
        value: { value: i },
      })),
    ],
  });
  await store.commit({
    expectedGeneration: 1,
    operationId: "rollover",
    changes: [
      {
        collection: "metadata",
        key: "large",
        value: Array.from(
          { length: 80 },
          (_, i) => `${i}:` + String.fromCharCode(33 + i).repeat(65536),
        ).join(""),
      },
    ],
  });
  const retention = await acquireImmutableReaderRetention(store, async () => {});
  resources.defer(() => retention.release());
  const snapshot = retention.head;
  const expected = [];
  for await (const [identity, sourceLocation] of store.objects.locations.entries(
    snapshot.locationRoot,
  ))
    if (decodeImmutableRecordReference(sourceLocation).segmentId !== snapshot.segmentTail.segmentId)
      expected.push({ identity, sourceLocation });
  assert.ok(expected.length > 100);
  return { store, sessionDir, snapshot, expected };
}

test("discovery resumes serialized cursors with cold stores, bounded work and no body reads", async (t) => {
  const { sessionDir, snapshot, expected } = await fixture(t);
  const found = [];
  let cursor = null;
  let calls = 0;
  do {
    const store = await ImmutableSessionStore.open({ sessionDir });
    store.objects.read = () => assert.fail("discovery must not read logical records or content");
    let pageReads = 0;
    const readPage = store.objects.locations.readPage.bind(store.objects.locations);
    store.objects.locations.readPage = (...args) => {
      pageReads += 1;
      return readPage(...args);
    };
    const page = await readImmutableCompactionPage(store, snapshot, {
      cursor,
      maxPages: 1,
      maxRecords: 3,
    });
    assert.ok(page.scannedPages <= 1);
    assert.ok(page.scannedRecords <= 3);
    assert.ok(page.seekPageReads <= DISCOVERY.pathDigits);
    assert.equal(pageReads, page.seekPageReads + page.scannedPages);
    assert.ok(page.sourceBytes <= BUDGET.bytes);
    assert.equal(page.complete, page.cursor === null);
    found.push(...page.records);
    if (page.cursor !== null) assert.notDeepEqual(page.cursor, cursor);
    cursor = JSON.parse(JSON.stringify(page.cursor));
    assert.ok(++calls < 2000, "discovery must converge even with a one-page budget");
  } while (cursor !== null);
  const ordered = (records) => records.toSorted((a, b) => a.identity.localeCompare(b.identity));
  assert.deepEqual(ordered(found), ordered(expected));
  assert.equal(new Set(found.map((item) => item.identity)).size, found.length);
});

test("discovered batches respect compaction bytes and feed the canonical relocation transaction", async (t) => {
  const { store, snapshot, expected, sessionDir } = await fixture(t);
  let cursor = null;
  let relocated = 0;
  let batches = 0;
  do {
    const page = await readImmutableCompactionPage(store, snapshot, {
      cursor,
      maxPages: DISCOVERY.maxPages,
    });
    if (page.records.length) {
      requireImmutableCompactionRecords(page.records, snapshot);
      assert.equal(
        page.sourceBytes,
        page.records.reduce(
          (sum, item) => sum + decodeImmutableRecordReference(item.sourceLocation).length,
          0,
        ),
      );
      const result = await compactSessionArtifacts({
        storageService,
        sessionDir,
        assertSessionWritable: async () => {},
        operationId: `discovered-${batches++}`,
        expectedGeneration: (await store.snapshot()).generation,
        records: page.records,
      });
      assert.deepEqual(result.result.conflicts, []);
      relocated += result.result.relocatedRecords;
    }
    cursor = page.cursor;
  } while (cursor !== null);
  assert.equal(relocated, expected.length);
  assert.ok(batches > 1, "byte and record limits must partition this source set");
  assert.deepEqual(await store.get(snapshot, "metadata", "item-0"), { value: 0 });
  const current = await store.snapshot();
  assert.deepEqual(await store.get(current, "metadata", "item-149"), { value: 149 });
});

test("reader cursors stay on their pinned snapshot during writes and reject another snapshot", async (t) => {
  const { store, sessionDir, expected } = await fixture(t);
  const reader = await openSessionArtifactReader({ sessionDir });
  try {
    const first = await reader.readCompactionPage({ maxPages: 1, maxRecords: 1 });
    assert.notEqual(first.cursor, null);
    await store.commit({
      expectedGeneration: reader.generation,
      operationId: "during-discovery",
      changes: [{ collection: "metadata", key: "later", value: true }],
    });
    await using newer = await openSessionArtifactReader({ sessionDir });
    await assert.rejects(newer.readCompactionPage({ cursor: first.cursor }), {
      code: "SESSION_COMPACTION_CURSOR_SNAPSHOT_MISMATCH",
    });
    const found = [...first.records];
    let cursor = first.cursor;
    do {
      const page = await reader.readCompactionPage({ cursor });
      found.push(...page.records);
      cursor = page.cursor;
    } while (cursor !== null);
    assert.equal(found.length, expected.length);
  } finally {
    await reader.close();
  }
  await assert.rejects(reader.readCompactionPage(), { code: "SESSION_READER_CLOSED" });
});

test("discovery owns its validated cursor while asynchronous page reads are pending", async (t) => {
  const { store, snapshot } = await fixture(t);
  const first = await readImmutableCompactionPage(store, snapshot, { maxRecords: 1 });
  assert.ok(first.cursor.path.length > 0);
  const expected = await readImmutableCompactionPage(store, snapshot, { cursor: first.cursor });
  const cursor = structuredClone(first.cursor);
  const readPage = store.objects.locations.readPage.bind(store.objects.locations);
  store.objects.locations.readPage = async (...args) => {
    const page = await readPage(...args);
    cursor.offset = Number.MAX_SAFE_INTEGER;
    cursor.path = "z";
    return page;
  };
  const actual = await readImmutableCompactionPage(store, snapshot, { cursor });
  assert.deepEqual(actual, expected);
});

test("discovery rejects invalid budgets, forged cursor paths and cancellation explicitly", async (t) => {
  const { store, snapshot } = await fixture(t);
  const first = await readImmutableCompactionPage(store, snapshot, { maxPages: 1 });
  for (const options of [
    { maxPages: 0 },
    { maxPages: 129 },
    { maxRecords: 0 },
    { maxRecords: 129 },
    { maxPages: NaN },
    { bypass: true },
    { cursor: { ...first.cursor, path: "z" } },
    { cursor: { ...first.cursor, offset: -1 } },
    { cursor: { ...first.cursor, extra: true } },
  ])
    await assert.rejects(readImmutableCompactionPage(store, snapshot, options), TypeError);
  await assert.rejects(
    readImmutableCompactionPage(store, snapshot, {
      cursor: { ...first.cursor, path: "f".repeat(64) },
    }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  const controller = new AbortController();
  const reason = new Error("stop discovery");
  controller.abort(reason);
  await assert.rejects(
    readImmutableCompactionPage(store, snapshot, { signal: controller.signal }),
    (error) => error === reason,
  );
  const during = new AbortController();
  const readPage = store.objects.locations.readPage.bind(store.objects.locations);
  store.objects.locations.readPage = async (...args) => {
    const page = await readPage(...args);
    setImmediate(() => during.abort(reason));
    return page;
  };
  await assert.rejects(
    readImmutableCompactionPage(store, snapshot, { signal: during.signal }),
    (error) => error === reason,
  );
});
