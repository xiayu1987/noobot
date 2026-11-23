/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import {
  committedAt,
  createMessageCase,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";

test("metadata reads preserve snapshot authority through settings commits and cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  let original;
  await journal.usingSnapshot(async (snapshot) => {
    original = await repository.readMetadata({ snapshot });
    assert.equal(original.sessionId, sessionId);
    assert.equal(original.parentSessionId, "");
    assert.equal(original.aggregateVersion, 0);
    assert.equal(Object.hasOwn(original, "messages"), false);
    await repository.commit(
      await prepare(journal, repository, "settings", {
        sessionMetadata: { customTitle: "published title", modelAlias: "selected-model" },
      }),
    );
    assert.deepEqual(await repository.readMetadata({ snapshot }), original);
  });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = openTestMessages(cold, sessionId);
  await cold.usingSnapshot(async (snapshot) => {
    const before = structuredClone(cold.head);
    const { result, work } = await observeStorageIo(root, () => reader.readMetadata({ snapshot }));
    assert.deepEqual(result, {
      ...original,
      customTitle: "published title",
      modelAlias: "selected-model",
      updatedAt: committedAt,
    });
    assert.ok(work.readBytes > 0);
    assert.ok(work.readBytes <= snapshot.limits.pageBytes);
    assert.equal(work.writeBytes, 0);
    assert.deepEqual(cold.head, before);
    const foreign = new PartitionSessionMessages(cold, {
      sessionId,
      parentSessionId: "foreign-parent",
    });
    await assert.rejects(foreign.readMetadata({ snapshot }), {
      code: "SESSION_SCOPE_IDENTITY_CONFLICT",
    });
    assert.deepEqual(cold.head, before);
  });
});

test("concurrent readers share one metadata read for a retained snapshot without sharing scope or mutable results", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const first = openTestMessages(journal, sessionId);
  const second = openTestMessages(journal, sessionId);
  const foreign = new PartitionSessionMessages(journal, { sessionId, parentSessionId: "foreign" });
  await journal.usingSnapshot(async (snapshot) => {
    const readSlots = journal.readRecordSlots.bind(journal);
    let reads = 0;
    journal.readRecordSlots = (...args) => {
      reads += 1;
      return readSlots(...args);
    };
    try {
      const [a, b] = await Promise.all([
        first.readMetadata({ snapshot }),
        second.readMetadata({ snapshot }),
        assert.rejects(foreign.readMetadata({ snapshot }), {
          code: "SESSION_SCOPE_IDENTITY_CONFLICT",
        }),
      ]);
      assert.equal(reads, 1);
      assert.deepEqual(a, b);
      a.customTitle = "caller mutation";
      assert.notEqual(b.customTitle, a.customTitle);
      const { result, work } = await observeStorageIo(root, () => first.readMetadata({ snapshot }));
      assert.deepEqual(result, b);
      assert.equal(work.readBytes, 0);
    } finally {
      journal.readRecordSlots = readSlots;
    }
  });
});

test("metadata reads reject an uninitialized session instead of supplying defaults", async (t) => {
  const { journal, sessionId } = await createTransactionCase(t);
  const repository = openTestMessages(journal, sessionId);
  await journal.usingSnapshot(async (snapshot) => {
    const before = structuredClone(journal.head);
    await assert.rejects(repository.readMetadata({ snapshot }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    assert.deepEqual(journal.head, before);
  });
});
