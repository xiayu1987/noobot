/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { partitionCheckpointOrderKey } from "@noobot/session-protocol/partition-summary-checkpoints";
import { decodePartitionJournalHead } from "@noobot/session-protocol/partition-journal";
import { journalHeadPath } from "../../src/session/partition-storage/journal-io.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { immutableCheckpointKey } from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { reconcileImmutableSessionStaging } from "../../src/workspace-lifecycle/reconcile-immutable-session-staging.js";
import { verifyImmutableSessionCheckpoints } from "../../src/workspace-lifecycle/verify-immutable-session-checkpoints.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
  journalTestLimits,
} from "../helpers/partition-journal-cases.js";
import { migratedWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import { createMessageCase } from "./partition-session-messages.test-helpers.js";

const sessionId = "s1";
const turn = "t0";
const head = { turnScopeId: turn, dialogProcessId: "d0", checkpointRevision: 3 };
const entry = (collection, key, value) => ({ collection, key, value });
const id = (revision) => `cp${revision}`;
const receipt = (revision, requestHash = `hash-${revision}`) =>
  entry("checkpoints", immutableCheckpointKey(turn, id(revision)), {
    checkpointId: id(revision),
    checkpointRevision: revision,
    requestHash,
    committedAt: "2026-01-01T00:00:00.000Z",
    markedCount: 1,
    persistedMessageUids: [],
    summarizedMessageUids: ["m0"],
    retainedMessageUids: [],
  });
const order = (revision, previousRevision, checkpointId = id(revision)) =>
  entry("checkpointOrder", partitionCheckpointOrderKey(turn, revision), {
    checkpointId,
    previousRevision,
  });
const sourceOrder = (revision, checkpointId = id(revision)) =>
  entry("checkpointOrder", immutableCheckpointKey(turn, immutableOrderKey(revision)), checkpointId);

test("empty staging preserves sparse checkpoint history and a head without live receipts", async (t) => {
  const { sessionDir, store } = await migratedWorkspace(t);
  const retainedRevisions = [1, 3];
  const checkpointHeads = [
    entry("checkpointHeads", turn, { ...head, checkpointRevision: 7 }),
    entry("checkpointHeads", "t1", {
      turnScopeId: "t1",
      dialogProcessId: "d1",
      checkpointRevision: 2,
    }),
  ];
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "seed-sparse-and-empty-checkpoint-history",
    changes: [
      checkpointHeads[0],
      ...retainedRevisions.flatMap((revision) => [receipt(revision), sourceOrder(revision)]),
      checkpointHeads[1],
    ],
  });
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  assert.equal(journal.head.sequence, 0);
  await journal.close();
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    (source) => source.identity,
  );
  const options = {
    sessionDir,
    stagingDir: root,
    expectedSource,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    limit: 2,
    maxBytes: 4096,
  };
  const adapter = getFsAdapter();
  const publications = [];
  let checkpointGeneration;
  const current = journalHeadPath(root);
  setFsAdapter({
    ...adapter,
    async rename(from, to) {
      await adapter.rename(from, to);
      if (String(to) === current)
        publications.push(decodePartitionJournalHead(await readFile(current)).sequence);
    },
  });
  let evidence;
  try {
    evidence = await reconcileImmutableSessionStaging(options, {
      checkpoint: null,
      seal: ({ target }) => {
        checkpointGeneration = target.generation;
      },
    });
  } finally {
    setFsAdapter(adapter);
  }
  const businessPublications = publications.filter(
    (generation) => generation <= checkpointGeneration,
  );
  assert.equal(businessPublications.at(-1), checkpointGeneration);
  assert.equal(
    businessPublications.at(-1) - businessPublications.at(-2),
    retainedRevisions.length + checkpointHeads.length,
    "linked receipts and checkpoint heads commit separately but share a publication",
  );
  assert.equal(evidence.receiptCount, expectedSource.generation);
  assert.deepEqual(await reconcileImmutableSessionStaging(options), evidence);
});

for (const [damage, mismatch] of [
  ["sparse history", null],
  ["head", /checkpoint head differs/],
  ["missing", /checkpoint history differs/],
  ["content", /checkpoint history differs/],
  ["source-order", /Orphan source checkpoint order/],
  ["target-order", /Orphan staged checkpoint index/],
  ["target-receipt", /Orphan or extra staged checkpoint record/],
  ["target-membership", /extra turnCheckpoints record/],
]) {
  test(`cold checkpoint migration reconciliation: ${damage}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    await store.commit({
      expectedGeneration: (await store.snapshot()).generation,
      operationId: "seed-source-checkpoints",
      changes: [
        entry("checkpointHeads", turn, head),
        receipt(1),
        receipt(3),
        sourceOrder(1),
        sourceOrder(3),
        ...(damage === "source-order" ? [sourceOrder(2, id(3))] : []),
      ],
    });
    const { journal, root } = await createMessageCase(t, {}, { sessionId });
    const { epoch, sequence } = journal.head;
    const mutations = [
      entry("checkpointHeads", turn, damage === "head" ? { ...head, checkpointRevision: 4 } : head),
      entry("turnCheckpoints", turn, 3),
      damage === "content" ? receipt(3, "changed") : receipt(3),
      order(3, damage === "missing" ? null : 1),
      ...(damage === "missing" ? [] : [receipt(1), order(1, null)]),
      ...(damage === "target-order" ? [order(2, null, id(3))] : []),
      ...(damage === "target-receipt" ? [receipt(2), order(2, null)] : []),
      ...(damage === "target-membership" ? [entry("turnCheckpoints", "other", 1)] : []),
    ].map((mutation) => ({ ...mutation, owner: null }));
    const commit = await commitFixtureTransaction(new PartitionTransactions(journal), {
      epoch,
      sequence: sequence + 1,
      expectedGeneration: sequence,
      operationId: "seed-staged-checkpoints",
      input: null,
      mutations,
      result: null,
    });
    assert.equal(commit.status, "committed");
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    const verify = () =>
      withImmutableSessionMigrationSource({ sessionDir, expectedSource: null }, (source) =>
        cold.usingSnapshot((snapshot) =>
          verifyImmutableSessionCheckpoints({
            source,
            journal: cold,
            scope: source.scope,
            snapshot,
            limit: 2,
            maxBytes: 4096,
          }),
        ),
      );
    if (mismatch)
      await assert.rejects(verify, {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        message: mismatch,
      });
    else await verify();
    assert.deepEqual(await readFile(current), before);
  });
}
