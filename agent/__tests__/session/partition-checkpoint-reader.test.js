/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  readPartitionCheckpoint,
  readPartitionCheckpointState,
} from "../../src/session/partition-storage/partition-checkpoint-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  createMessageCase,
  openTestMessages,
  prepare,
  message,
  scope,
} from "./partition-session-messages.test-helpers.js";

function receipt(revision) {
  return {
    checkpointId: `checkpoint-${revision}`,
    checkpointRevision: revision,
    requestHash: "hash",
    committedAt: "2026-11-20T00:00:00.000Z",
    markedCount: 1,
    persistedMessageUids: [],
    summarizedMessageUids: ["source"],
    retainedMessageUids: [],
  };
}

function chain(revisions) {
  const values = new Map();
  const reads = [];
  const put = (collection, key, value) => values.set(JSON.stringify([collection, key]), value);
  put("checkpointHeads", "turn", {
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    checkpointRevision: revisions[0],
  });
  put("turnCheckpoints", "turn", revisions[0]);
  revisions.forEach((revision, index) => {
    put("checkpointOrder", JSON.stringify(["turn", revision]), {
      checkpointId: `checkpoint-${revision}`,
      previousRevision: revisions[index + 1] ?? null,
    });
    put("checkpoints", JSON.stringify(["turn", `checkpoint-${revision}`]), receipt(revision));
  });
  const read = async ({ collection, keys, includeOwner }) =>
    new Map(
      keys.map((key) => {
        reads.push([collection, key]);
        const id = JSON.stringify([collection, key]);
        const value = values.has(id) ? values.get(id) : null;
        return [key, value === null ? null : includeOwner ? { mutation: { value } } : { value }];
      }),
    );
  return { read, reads, put };
}

test("checkpoint state bounds work by the protocol receipt window, independent of historical revisions", async () => {
  const limit = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit;
  for (const highest of [limit + 10, 1000000]) {
    const fixture = chain(Array.from({ length: limit + 10 }, (_, index) => highest - index));
    const state = await readPartitionCheckpointState(fixture.read, "turn");
    assert.equal(state.checkpointRevision, highest);
    assert.equal(state.receipts.length, limit);
    assert.equal(state.receipts[0].checkpointRevision, highest - limit + 1);
    assert.equal(fixture.reads.length, 2 + 2 * limit);
    assert.equal(
      (await readPartitionCheckpoint(fixture.read, "turn", `checkpoint-${highest - limit - 1}`))
        .checkpointRevision,
      highest - limit - 1,
    );
  }
  const fixture = chain([1000000, 2]);
  assert.deepEqual(
    (await readPartitionCheckpointState(fixture.read, "turn")).receipts.map(
      ({ checkpointRevision }) => checkpointRevision,
    ),
    [2, 1000000],
  );
  assert.equal(fixture.reads.length, 6);
});

test("checkpoint readers reject missing links, invalid receipts, and orphan state", async () => {
  for (const damage of [
    (f) => f.put("turnCheckpoints", "turn", null),
    (f) => f.put("checkpointHeads", "turn", null),
    (f) => f.put("checkpointOrder", '["turn",2]', null),
    (f) =>
      f.put("checkpointOrder", '["turn",2]', { checkpointId: "checkpoint-2", previousRevision: 2 }),
    (f) => f.put("checkpoints", '["turn","checkpoint-2"]', null),
    (f) =>
      f.put("checkpoints", '["turn","checkpoint-2"]', { ...receipt(2), checkpointId: "wrong" }),
  ]) {
    const fixture = chain([2, 1]);
    damage(fixture);
    await assert.rejects(readPartitionCheckpointState(fixture.read, "turn"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
  const fixture = chain([2, 1]);
  fixture.put("checkpointOrder", '["turn",2]', {
    checkpointId: "checkpoint-1",
    previousRevision: null,
  });
  fixture.put("checkpoints", '["turn","checkpoint-1"]', {
    ...receipt(2),
    checkpointId: "checkpoint-1",
  });
  await assert.rejects(readPartitionCheckpoint(fixture.read, "turn", "checkpoint-2"), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});

test("real checkpoint reads preserve old snapshots, suffix survivors and cold reads", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const checkpoint = (uid, id, revision) => ({
    ...scope,
    sessionId,
    userId: "admin",
    checkpointId: id,
    expectedCheckpointRevision: revision,
    messages: [],
    persistedMessageUids: [],
    summarizedMessageUids: [uid],
    retainedMessageUids: [],
  });
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [
        message(sessionId, "prefix"),
        { ...message(sessionId, "anchor"), turnScopeId: "other" },
        message(sessionId, "suffix"),
      ],
      summaryCheckpoints: [checkpoint("prefix", "prefix", 0), checkpoint("suffix", "suffix", 1)],
    }),
  );
  const read = (reader, snapshot) =>
    reader.readCheckpointState({ snapshot, turnScopeId: scope.turnScopeId });
  await journal.usingSnapshot(async (old) => {
    await repository.commit(
      await prepare(journal, repository, "delete", {
        messageDeletion: { commandId: "delete", anchor: { turnScopeId: "other" } },
      }),
    );
    assert.equal((await read(repository, old)).receipts.length, 2);
  });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = openTestMessages(cold, sessionId);
  await cold.usingSnapshot(async (snapshot) => {
    const state = await read(reader, snapshot);
    assert.equal(state.checkpointRevision, 2);
    assert.deepEqual(
      state.receipts.map(({ checkpointId }) => checkpointId),
      ["prefix"],
    );
    assert.equal(
      await reader.readCheckpoint({
        snapshot,
        turnScopeId: scope.turnScopeId,
        checkpointId: "suffix",
      }),
      null,
    );
    assert.equal(
      (
        await reader.readCheckpoint({
          snapshot,
          turnScopeId: scope.turnScopeId,
          checkpointId: "prefix",
        })
      ).checkpointRevision,
      1,
    );
  });
  await reader.commit(
    await prepare(cold, reader, "delete-all", {
      messageDeletion: { commandId: "delete-all", anchor: { turnScopeId: scope.turnScopeId } },
    }),
  );
  await cold.usingSnapshot(async (snapshot) => assert.equal(await read(reader, snapshot), null));
});
