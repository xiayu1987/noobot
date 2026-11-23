/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { reconcileImmutableSessionStaging } from "../../src/workspace-lifecycle/reconcile-immutable-session-staging.js";
import { migratedWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import {
  sessionId,
  message,
  initializeStaging,
  importStagingMessages,
  targetStorageBudget,
} from "./immutable-session-migration-cases.js";

for (const [name, value, remove, mismatch, key = "titleCandidates:"] of [
  ["missing root", null, true, /Invalid context directory page/],
  ["missing member", { ordinals: [1, 3] }, false, /title candidates differ/],
  ["extra member", { ordinals: [1, 2, 3, 4] }, false, /extra ordinal/],
  ["wrong member", { ordinals: [1, 2, 4] }, false, /title candidates differ/],
  ["unordered members", { ordinals: [2, 1, 3] }, false, /Invalid context directory ordinals/],
  ["missing child", { slots: [0] }, false, /Invalid context directory page/],
  [
    "orphan page",
    { ordinals: [1] },
    false,
    /Unreferenced title candidate page/,
    "titleCandidates:00",
  ],
  [
    "invalid page key",
    { ordinals: [1] },
    false,
    /Invalid context directory page/,
    "titleCandidates:bad",
  ],
]) {
  test(`offline reconciliation rejects title candidate ${name} before publication`, async (t) => {
    const { sessionDir } = await migratedWorkspace(t);
    const { journal, root } = await createTransactionCase(t, {}, { sessionId });
    const expectedSource = await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await initializeStaging(journal, source);
        await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
        return source.identity;
      },
    );
    const transactions = new PartitionTransactions(journal);
    const collection = "metadata";
    const entry = await journal.usingSnapshot((snapshot) =>
      transactions.withCollectionReader(snapshot, async (read) =>
        (await read({ collection, keys: [key], includeOwner: true })).get(key),
      ),
    );
    const owner = entry?.owner ?? null;
    const { epoch, sequence } = journal.head;
    assert.equal(
      (
        await commitFixtureTransaction(transactions, {
          epoch,
          expectedGeneration: sequence,
          sequence: sequence + 1,
          operationId: "corrupt-title-candidates",
          input: null,
          mutations: [{ collection, key, owner, ...(remove ? { remove: true } : { value }) }],
          result: null,
        })
      ).status,
      "committed",
    );
    await journal.close();
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await assert.rejects(
      reconcileImmutableSessionStaging({
        sessionDir,
        stagingDir: root,
        expectedSource,
        targetStorageBudget,
        limit: 1,
        maxBytes: 4096,
      }),
      mismatch,
    );
    assert.deepEqual(await readFile(current), before);
  });
}
