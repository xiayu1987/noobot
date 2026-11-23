/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readImmutableContextCandidatePage } from "../../src/session/session-artifact-session/immutable-context-source-index.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { upgradeImmutableContextIndexes } from "../../src/session/session-artifact-session/immutable-context-index-upgrade.js";
import {
  CONTEXT_READ_LIMITS,
  CONTEXT_BUDGET_ERROR,
} from "@noobot/session-protocol/context-read-budget";
import {
  invalid,
  message,
  fixture,
  commit,
  corrupt,
  assistantMessage,
} from "./immutable-context-tail-read.test-helpers.js";

test("candidate pages seek across sparse turn ordinals without enumerating hash indexes or bodies", async (t) => {
  const store = await fixture(t);
  const hidden = Array.from({ length: 512 }, (_, index) =>
    assistantMessage(`hidden-${index}`, {
      dialogProcessId: "d-current",
      turnScopeId: "t-current",
      summarized: true,
      presentationMessageId: "p-current",
    }),
  );
  await commit(store, "sparse-candidates", {
    messages: [
      ...hidden,
      {
        ...message("last"),
        dialogProcessId: "d-current",
        turnScopeId: "t-current",
        content: "large🙂".repeat(100000),
      },
    ],
  });
  const snapshot = await store.snapshot();
  t.mock.method(store.index, "entries", () => assert.fail("candidate pages must seek by ordinal"));
  const materialize = store.objects.materializeValues.bind(store.objects);
  t.mock.method(store.objects, "materializeValues", (records, options) => {
    assert.ok(
      records.every(({ parts }) => parts.length === 0),
      "candidate bodies must stay deferred",
    );
    return materialize(records, options);
  });
  const get = store.get.bind(store);
  let rangeReads = 0;
  t.mock.method(store, "get", (head, collection, key) => {
    if (collection === "contextCandidateRanges") rangeReads += 1;
    return get(head, collection, key);
  });
  const first = await readImmutableContextCandidatePage({
    store,
    snapshot,
    turnScopeId: "t-current",
    limit: 1,
    limits: { ...CONTEXT_READ_LIMITS, candidates: 1, bytes: 4096 },
  });
  assert.equal(first.generation, snapshot.generation);
  assert.equal(first.cursor, 514);
  assert.equal(first.hasMore, true);
  assert.equal(first.total, 2);
  assert.equal(first.records[0].value.message.messageUid, "m-last");
  assert.equal(first.records[0].value.message.content, null);
  assert.ok(rangeReads <= 8, `sparse range read ${rangeReads} directory nodes`);
  const second = await readImmutableContextCandidatePage({
    store,
    snapshot,
    turnScopeId: "t-current",
    before: first.cursor,
    limit: 1,
  });
  assert.equal(second.cursor, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.records[0].value.message.messageUid, "m-current");
  const end = await readImmutableContextCandidatePage({
    store,
    snapshot,
    turnScopeId: "t-current",
    before: second.cursor,
    limit: 1,
  });
  assert.deepEqual(end.records, []);
  assert.equal(end.cursor, 1);
  assert.equal(end.hasMore, false);
});

test("candidate pagination returns each committed position once across directory byte boundaries", async (t) => {
  const store = await fixture(t);
  await commit(store, "many-candidates", {
    messages: Array.from({ length: 300 }, (_, index) => ({
      ...message(`page-${index}`),
      dialogProcessId: "d-current",
      turnScopeId: "t-current",
    })),
  });
  const snapshot = await store.snapshot();
  const readMetadata = store.objects.readValuesMetadata.bind(store.objects);
  let decoded = 0;
  t.mock.method(store.objects, "readValuesMetadata", (references, options) => {
    assert.ok(references.length <= 31);
    decoded += references.length;
    return readMetadata(references, options);
  });
  let before = 0;
  const ordinals = [];
  let page;
  do {
    page = await readImmutableContextCandidatePage({
      store,
      snapshot,
      turnScopeId: "t-current",
      before,
      limit: 31,
    });
    ordinals.push(...page.records.map(({ value }) => value.turnOrdinal));
    before = page.cursor;
  } while (page.hasMore);
  assert.deepEqual(
    ordinals,
    Array.from({ length: 301 }, (_, index) => 301 - index),
  );
  assert.equal(decoded, 301);
});

test("reader candidate cursors stay on their retained snapshot when the turn grows", async (t) => {
  const store = await fixture(t);
  await using reader = await openImmutableSessionReader({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    parentSessionId: "",
  });
  const first = await reader.readContextCandidatePage({ turnScopeId: "t-current", limit: 1 });
  await commit(store, "append-after-reader", {
    messages: [{ ...message("later"), dialogProcessId: "d-current", turnScopeId: "t-current" }],
  });
  assert.deepEqual(
    await reader.readContextCandidatePage({ turnScopeId: "t-current", limit: 1 }),
    first,
  );
  const current = await readImmutableContextCandidatePage({
    store,
    snapshot: await store.snapshot(),
    turnScopeId: "t-current",
    limit: 1,
  });
  assert.equal(current.records[0].value.message.messageUid, "m-later");
  assert.notEqual(current.generation, first.generation);
});

test("candidate page validates count, cursor and byte budgets before returning partial data", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const options = { store, snapshot, turnScopeId: "t-current", limit: 1 };
  for (const changed of [
    { limit: 0 },
    { limit: Infinity },
    { limit: Number.MAX_SAFE_INTEGER },
    { before: -1 },
    { before: 0.5 },
    { turnScopeId: " " },
  ])
    await assert.rejects(readImmutableContextCandidatePage({ ...options, ...changed }), TypeError);
  await assert.rejects(readImmutableContextCandidatePage({ ...options, before: 2 }), invalid);
  await assert.rejects(
    readImmutableContextCandidatePage({
      ...options,
      limits: { ...CONTEXT_READ_LIMITS, bytes: 1 },
    }),
    { code: CONTEXT_BUDGET_ERROR, dimension: "bytes" },
  );
  assert.deepEqual(await store.snapshot(), snapshot);
});

test("candidate page rejects a missing range and never scans the UUID index as a repair", async (t) => {
  const store = await fixture(t);
  const descriptor = await store.get(await store.snapshot(), "contextSources", "t-current");
  const snapshot = await corrupt(store, [
    {
      collection: "contextSources",
      key: "t-current",
      value: { ...descriptor, directory: { slots: [0] } },
    },
  ]);
  t.mock.method(store.index, "entries", () => assert.fail("damaged range must fail explicitly"));
  await assert.rejects(
    readImmutableContextCandidatePage({
      store,
      snapshot,
      turnScopeId: "t-current",
      limit: 1,
    }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  const repaired = await readImmutableContextCandidatePage({
    store,
    snapshot: await store.snapshot(),
    turnScopeId: "t-current",
    limit: 1,
  });
  assert.equal(repaired.records[0].value.message.messageUid, "m-current");
});
