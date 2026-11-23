/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPartitionCollectionReadBudget } from "@noobot/session-protocol/partition-collection-query";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  entityDirectoryPageDependencies,
  readEntityDirectoryNode,
} from "../../src/session/partition-storage/entity-directory-io.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";
import { createAt } from "./partition-transactions.test-helpers.js";

async function collectPages(journal, snapshot, position, pages) {
  const key = JSON.stringify(position);
  if (pages.has(key)) return;
  const page = await readEntityDirectoryNode(
    journal,
    snapshot,
    position,
    createPartitionCollectionReadBudget(snapshot),
  );
  pages.set(key, { position, page });
  for (const dependency of entityDirectoryPageDependencies(page))
    await collectPages(journal, snapshot, dependency, pages);
}

test("independent query budgets share bounded directory pages only within their journal snapshot", async (t) => {
  const { journal, root, sessionId } = await createTransactionCase(t, { pageRecords: 1 });
  const writer = new PartitionTransactions(journal);
  for (let sequence = 1; sequence <= 64; sequence++)
    await commitFixtureTransaction(writer, createAt(journal, sequence));
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await cold.usingSnapshot(async (snapshot) => {
    const pages = new Map();
    await collectPages(cold, snapshot, snapshot.entityDirectory.identities.position, pages);
    assert.ok(pages.size > snapshot.limits.pageRecords);
    const bytes = [...pages.values()].reduce((sum, { position }) => sum + position.bytes, 0);
    assert.ok(bytes <= snapshot.limits.pageBytes);
    const { reads } = await observeDirectoryPageReads(async () => {
      for (const { position, page } of pages.values())
        assert.deepEqual(
          await readEntityDirectoryNode(
            cold,
            snapshot,
            position,
            createPartitionCollectionReadBudget(snapshot),
          ),
          page,
        );
    });
    assert.deepEqual(reads, []);
    const independent = await PartitionJournal.open({ root, sessionId });
    t.after(() => independent.close());
    const observed = await observeDirectoryPageReads(() =>
      independent.usingSnapshot(async (other) => {
        const root = await readEntityDirectoryNode(
          independent,
          other,
          other.entityDirectory.identities.position,
          createPartitionCollectionReadBudget(other),
        );
        assert.deepEqual(
          root,
          pages.get(JSON.stringify(snapshot.entityDirectory.identities.position)).page,
        );
      }),
    );
    assert.ok(observed.reads.length > 0);
  });
});
