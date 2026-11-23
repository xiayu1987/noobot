/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createSessionDisplayStats } from "@noobot/session-protocol/session-reader";
import {
  stagePartitionDisplayPublication,
  readPartitionDisplayPublicationPage,
  seedPartitionDisplayPublication,
} from "../../src/session/partition-storage/partition-display-publication.js";
import { createPartitionIndexMutations } from "../../src/session/partition-storage/partition-index-mutations.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";

test("projection writes batch ownership checks within the snapshot key budget", async () => {
  const reads = [];
  const collection = "metadata";
  const owner = { epoch: "epoch", partition: 0, sequence: 1 };
  const mutations = [{ collection, key: "staged", value: true, owner: null }];
  const plan = createPartitionIndexMutations(
    {
      pageRecords: 2,
      async getLatestMany({ keys }) {
        reads.push(["latest", keys]);
        return new Map([
          ["retired", { owner, mutation: { value: true } }],
          ["staged", null],
        ]);
      },
      async getCreationOwners({ keys }) {
        reads.push(["owner", keys]);
        return new Map(keys.map((key) => [key, key === "reused" ? owner : null]));
      },
    },
    mutations,
  );
  plan.set(collection, "new-1", true);
  plan.remove(collection, "retired");
  plan.set(collection, "reused", true);
  plan.remove(collection, "staged");
  plan.set(collection, "new-2", true);
  await plan.apply();
  assert.deepEqual(reads, [
    ["latest", ["retired", "staged"]],
    ["owner", ["new-1", "reused"]],
    ["owner", ["new-2"]],
  ]);
  assert.deepEqual(mutations, [
    { collection, key: "new-1", value: true, owner: null },
    { collection, key: "retired", remove: true, owner },
    { collection, key: "reused", value: true, owner },
    { collection, key: "new-2", value: true, owner: null },
  ]);
});

test("projection readers reuse the same original lookup without exposing staged values", async () => {
  const collection = "metadata";
  const key = "statistics";
  const owner = { epoch: "epoch", partition: 0, sequence: 1 };
  const reads = [];
  const plan = createPartitionIndexMutations(
    {
      pageRecords: 2,
      async getLatestMany(query) {
        reads.push(query);
        return new Map([[key, { owner, mutation: { collection, key, owner, value: 1 } }]]);
      },
    },
    [],
  );
  const query = { collection, keys: [key] };
  assert.equal((await plan.readOriginal(query)).get(key).value, 1);
  assert.equal(await plan.get(collection, key), 1);
  plan.set(collection, key, 2);
  assert.equal((await plan.readStaged(query)).get(key).value, 2);
  assert.equal((await plan.readOriginal(query)).get(key).value, 1);
  await plan.apply();
  assert.deepEqual(reads, [query]);
});

function sourceStatistics(count) {
  return {
    messageCount: count,
    injectedMessageCount: 0,
    toolLogCount: 0,
    displayToolLogCount: 0,
    unassignedToolArtifactCount: 0,
    conflictedToolArtifactCount: 0,
    thinkingMessageCount: 0,
  };
}

function stats(count, attachmentCount = 0) {
  return createSessionDisplayStats({
    ...sourceStatistics(count),
    displayMessageCount: count,
    thinkingMessageCount: 0,
    attachmentCount,
  });
}

function readWindow(
  transactions,
  snapshot,
  limit,
  { maxBytes = 4096, select = () => {}, cursor = null } = {},
) {
  return transactions.withCollectionReader(snapshot, (read) =>
    readPartitionDisplayPublicationPage(
      (query) => {
        select(query.keys);
        return read(query);
      },
      { journal: transactions.journal, snapshot, parentSessionId: "", aggregateVersion: 1 },
      { cursor, direction: "forward", limit, maxBytes },
    ),
  );
}

async function readProjection(...args) {
  const { stats, messages } = await readWindow(...args);
  return { stats, messages };
}

for (const published of [false, true]) {
  test(`ranked display publication recovers as one transaction after a fault ${published ? "after" : "before"} CURRENT rename`, async (t) => {
    const { journal, root, sessionId } = await createTransactionCase(
      t,
      { pageRecords: 1 },
      { autoClose: false },
    );
    const writer = new PartitionTransactions(journal);
    const { epoch } = journal.head;
    await commitFixtureTransaction(writer, {
      epoch,
      operationId: "seed-display",
      expectedGeneration: 0,
      sequence: 1,
      input: null,
      mutations: seedPartitionDisplayPublication(stats(0)),
      result: null,
    });
    const attachment = {
      attachmentId: "upload",
      attachmentSource: "user",
      sessionId,
      name: "input.txt",
      mimeType: "text/plain",
    };
    const row = {
      messageUid: "visible",
      turnPlaceholder: true,
      content: "\u{1F642}".repeat(512),
      attachments: [attachment, attachment],
      transferEnvelopes: [],
    };
    const later = {
      messageUid: "later",
      turnPlaceholder: true,
      attachments: [],
      transferEnvelopes: [],
    };
    const input = {
      artifactAttachmentDelta: 0,
      sourceStatistics: sourceStatistics(2),
      changes: [row, later].map((row, i) => ({ order: [0, i + 1, 0], existed: false, row })),
    };
    const request = { epoch, expectedGeneration: 1, operationId: "publish-display", input };
    const commit = (transactions) =>
      transactions.commit(request, {
        validateScope: () => {},
        async prepare(_snapshot, view, publication) {
          const mutations = [];
          const plan = createPartitionIndexMutations(view, mutations);
          await stagePartitionDisplayPublication(plan, publication);
          await plan.apply();
          return { action: "commit", mutations, result: null };
        },
      });
    await journal.usingSnapshot(async (retained) => {
      const adapter = getFsAdapter();
      const fault = Object.assign(new Error("display publication fault"), { code: "EIO" });
      setFsAdapter({
        ...adapter,
        async rename(source, target) {
          if (String(target) !== join(root, "CURRENT")) return adapter.rename(source, target);
          if (published) await adapter.rename(source, target);
          throw fault;
        },
      });
      try {
        await assert.rejects(commit(writer), (error) => {
          assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN", error.stack);
          assert.strictEqual(error.cause, fault);
          return true;
        });
      } finally {
        setFsAdapter(adapter);
      }
      const cold = await PartitionJournal.open({ root, sessionId });
      t.after(() => cold.close());
      const recovered = new PartitionTransactions(cold);
      const current = (length) =>
        cold.usingSnapshot((snapshot) => readProjection(recovered, snapshot, length));
      const empty = { stats: stats(0), messages: [] };
      const full = { stats: stats(2, 1), messages: [row, later] };
      assert.deepEqual(await current(2), published ? full : empty);
      const receipt = await commit(recovered);
      assert.equal(receipt.generation, request.expectedGeneration + 1);
      assert.equal(receipt.replayed, published);
      assert.deepEqual(await commit(recovered), { ...receipt, replayed: true });
      assert.deepEqual(await current(2), full);
      const rowQueries = [];
      await assert.rejects(
        cold.usingSnapshot((snapshot) =>
          readWindow(recovered, snapshot, 2, {
            maxBytes: 1024,
            select: (keys) =>
              rowQueries.push(...keys.filter((key) => key.startsWith("display:row"))),
          }),
        ),
        { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" },
      );
      assert.equal(rowQueries.length, 1);
      assert.match(rowQueries[0], /^display:row:/);
      assert.deepEqual(await readProjection(writer, retained, 2), empty);
      await cold.usingSnapshot(async (first) => {
        const { nextCursor: cursor } = await readWindow(recovered, first, 1);
        assert.notEqual(cursor, null);
        await cold.usingSnapshot(async (second) => {
          assert.equal(first.sequence, second.sequence);
          await assert.rejects(readWindow(recovered, second, 1, { cursor }), {
            code: "SESSION_PAGE_CURSOR_CONFLICT",
          });
        });
        const next = await readWindow(recovered, first, 1, { cursor });
        assert.deepEqual(next.messages, [later]);
        assert.equal(next.nextCursor, null);
      });
    });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  });
}
