/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { readPartitionCheckpointPage } from "../../src/session/partition-storage/partition-checkpoint-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const snapshot = {
  sessionId: "session",
  epoch: "epoch",
  sequence: 7,
  limits: { pageRecords: 2, pageBytes: 4096 },
};

test("a checkpoint can update compressed message records whose decoded JSON exceeds a page", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const messages = Array.from({ length: 3 }, (_, index) => {
    const block = Array.from({ length: 48 }, (_, part) =>
      createHash("sha256").update(`${index}:${part}`).digest("hex"),
    ).join("");
    return {
      ...message(sessionId, `source-${index}`),
      modelAdditionalKwargs: { reasoning: { type: "reasoning", text: block.repeat(3) } },
    };
  });
  for (const source of messages)
    await repository.commit(
      await prepare(journal, repository, source.messageUid, { messages: [source] }),
    );

  const messageUids = messages.map(({ messageUid }) => messageUid);
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    let decodedBytes = 0;
    for (const uid of messageUids) {
      const records = await transactions.getLatestMany({
        snapshot,
        collection: "messages",
        keys: [uid],
      });
      decodedBytes += Buffer.byteLength(JSON.stringify([uid, records.get(uid)]));
    }
    assert.ok(decodedBytes > snapshot.limits.pageBytes);
  });

  const checkpointId = "compressed-messages";
  const checkpoint = {
    ...scope,
    userId: "admin",
    sessionId,
    checkpointId,
    expectedCheckpointRevision: 0,
    messages: [],
    persistedMessageUids: [],
    summarizedMessageUids: messageUids,
    retainedMessageUids: [],
  };
  const { result } = await repository.commit(
    await prepare(journal, repository, checkpointId, { summaryCheckpoints: [checkpoint] }),
  );
  assert.equal(result.summaryCheckpoints[0].committed, true);
  assert.equal(result.summaryCheckpoints[0].markedCount, messageUids.length);

  await journal.usingSnapshot(async (snapshot) => {
    const records = await transactions.getLatestMany({
      snapshot,
      collection: "messages",
      keys: messageUids,
    });
    for (const [index, uid] of messageUids.entries()) {
      const { message: stored } = records.get(uid).value;
      assert.equal(stored.summarized, true);
      assert.deepEqual(stored.modelAdditionalKwargs, messages[index].modelAdditionalKwargs);
    }
  });
});

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
    const checkpointId = `checkpoint-${revision}`;
    put("checkpointOrder", JSON.stringify(["turn", revision]), {
      checkpointId,
      previousRevision: revisions[index + 1] ?? null,
    });
    put("checkpoints", JSON.stringify(["turn", checkpointId]), {
      checkpointId,
      checkpointRevision: revision,
      requestHash: "hash",
      committedAt: "2026-11-20T00:00:00.000Z",
      markedCount: 1,
      persistedMessageUids: [],
      summarizedMessageUids: ["source"],
      retainedMessageUids: [],
    });
  });
  const read = async ({ collection, keys, includeOwner }) =>
    new Map(
      keys.map((key) => {
        reads.push([collection, key]);
        const value = values.get(JSON.stringify([collection, key])) ?? null;
        return [key, value === null ? null : includeOwner ? { mutation: { value } } : { value }];
      }),
    );
  return { read, reads, put };
}

test("checkpoint pages traverse only live links and keep work independent of revision gaps", async () => {
  for (const highest of [10, 1000000]) {
    const fixture = chain([highest, 4, 2]);
    const first = await readPartitionCheckpointPage(fixture.read, snapshot, {
      turnScopeId: "turn",
      cursor: null,
      limit: 2,
      maxBytes: snapshot.limits.pageBytes,
    });
    assert.deepEqual(
      first.receipts.map(({ checkpointRevision }) => checkpointRevision),
      [highest, 4],
    );
    assert.equal(fixture.reads.length, 6);
    const next = await readPartitionCheckpointPage(fixture.read, snapshot, {
      turnScopeId: "turn",
      cursor: first.nextCursor,
      limit: 1,
      maxBytes: snapshot.limits.pageBytes,
    });
    assert.deepEqual(
      next.receipts.map(({ checkpointRevision }) => checkpointRevision),
      [2],
    );
    assert.equal(next.nextCursor, null);
    assert.equal(fixture.reads.length, 10);
  }
});

test("checkpoint pages reject corruption and invalid cursors without scanning for substitutes", async () => {
  for (const damage of [
    (f) => f.put("turnCheckpoints", "turn", null),
    (f) => f.put("checkpointHeads", "turn", null),
    (f) => f.put("checkpointOrder", '["turn",4]', null),
    (f) => f.put("checkpoints", '["turn","checkpoint-4"]', null),
    (f) =>
      f.put("checkpointOrder", '["turn",4]', { checkpointId: "checkpoint-4", previousRevision: 4 }),
  ]) {
    const fixture = chain([4, 2]);
    damage(fixture);
    await assert.rejects(
      readPartitionCheckpointPage(fixture.read, snapshot, {
        turnScopeId: "turn",
        cursor: null,
        limit: 1,
        maxBytes: snapshot.limits.pageBytes,
      }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
  }
  const fixture = chain([4, 2]);
  const page = await readPartitionCheckpointPage(fixture.read, snapshot, {
    turnScopeId: "turn",
    cursor: null,
    limit: 1,
    maxBytes: snapshot.limits.pageBytes,
  });
  const before = fixture.reads.length;
  await assert.rejects(
    readPartitionCheckpointPage(
      fixture.read,
      { ...snapshot, sequence: 8 },
      {
        turnScopeId: "turn",
        cursor: page.nextCursor,
        limit: 1,
        maxBytes: snapshot.limits.pageBytes,
      },
    ),
    TypeError,
  );
  assert.equal(fixture.reads.length, before);
  await assert.rejects(
    readPartitionCheckpointPage(fixture.read, snapshot, {
      turnScopeId: "turn",
      cursor: { ...page.nextCursor, revision: 5 },
      limit: 1,
      maxBytes: snapshot.limits.pageBytes,
    }),
    TypeError,
  );
  fixture.put("checkpointHeads", "turn", null);
  fixture.put("turnCheckpoints", "turn", null);
  assert.equal(
    await readPartitionCheckpointPage(fixture.read, snapshot, {
      turnScopeId: "turn",
      cursor: null,
      limit: 1,
      maxBytes: snapshot.limits.pageBytes,
    }),
    null,
  );
});

test("checkpoint paging retains snapshot history across deletion and resumes after cold reopen", async (t) => {
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
    await prepare(journal, repository, "seed-page", {
      messages: [
        message(sessionId, "prefix"),
        { ...message(sessionId, "anchor"), turnScopeId: "other" },
        message(sessionId, "suffix"),
      ],
      summaryCheckpoints: [
        checkpoint("prefix", "first", 0),
        checkpoint("suffix", "removed", 1),
        checkpoint("prefix", "last", 2),
      ],
    }),
  );
  const options = { turnScopeId: scope.turnScopeId, cursor: null, limit: 1, maxBytes: 4096 };
  let retainedSnapshot;
  let nextCursor;
  await journal.usingSnapshot(async (old) => {
    const first = await repository.readCheckpointPage({ snapshot: old, ...options });
    assert.deepEqual(
      first.receipts.map(({ checkpointId }) => checkpointId),
      ["last"],
    );
    await repository.commit(
      await prepare(journal, repository, "delete-page", {
        messageDeletion: { commandId: "delete-page", anchor: { turnScopeId: "other" } },
      }),
    );
    const history = await repository.readCheckpointPage({
      snapshot: old,
      ...options,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      history.receipts.map(({ checkpointId }) => checkpointId),
      ["removed"],
    );
    await journal.usingSnapshot(async (current) => {
      await assert.rejects(
        repository.readCheckpointPage({ snapshot: current, ...options, cursor: first.nextCursor }),
        TypeError,
      );
      const latest = await repository.readCheckpointPage({ snapshot: current, ...options });
      assert.deepEqual(
        latest.receipts.map(({ checkpointId }) => checkpointId),
        ["last"],
      );
      assert.equal(latest.nextCursor.revision, 1);
      retainedSnapshot = { ...current };
      nextCursor = latest.nextCursor;
    });
  });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = openTestMessages(cold, sessionId);
  await cold.usingSnapshot(async (current) => {
    assert.equal(current.sequence, retainedSnapshot.sequence);
    const page = await reader.readCheckpointPage({
      snapshot: current,
      ...options,
      cursor: nextCursor,
    });
    assert.deepEqual(
      page.receipts.map(({ checkpointId }) => checkpointId),
      ["first"],
    );
    assert.equal(page.nextCursor, null);
    await assert.rejects(
      reader.readCheckpointPage({
        snapshot: current,
        ...options,
        limit: current.limits.pageRecords + 1,
      }),
      { code: "SESSION_QUERY_BUDGET" },
    );
  });
});

async function seedCheckpoints(t, count, pageBytes) {
  const fixture = await createMessageCase(t, {
    transactionBytes: 16 * 1024,
    pageRecords: Math.max(8, QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit),
    pageBytes,
  });
  const { journal, sessionId } = fixture;
  const repository = openTestMessages(journal, sessionId);
  for (let revision = 1; revision <= count; revision += 1) {
    const uid = `source-${revision}`;
    await repository.commit(
      await prepare(journal, repository, `seed-${revision}`, {
        messages: [message(sessionId, uid)],
        summaryCheckpoints: [
          {
            ...scope,
            sessionId,
            userId: "admin",
            checkpointId: `checkpoint-${revision}`,
            expectedCheckpointRevision: revision - 1,
            messages: [],
            persistedMessageUids: [],
            summarizedMessageUids: [uid],
            retainedMessageUids: [],
          },
        ],
      }),
    );
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root: fixture.root, sessionId });
  t.after(() => cold.close());
  return { ...fixture, journal: cold, reader: openTestMessages(cold, sessionId) };
}

test("cold checkpoint pages bound physical reads as history grows", async (t) => {
  const costs = [];
  for (const count of [12, 60]) {
    const { journal, root, reader } = await seedCheckpoints(t, count, 256 * 1024);
    await journal.usingSnapshot(async (snapshot) => {
      const { result, work } = await observeStorageIo(root, () =>
        reader.readCheckpointPage({
          snapshot,
          turnScopeId: scope.turnScopeId,
          cursor: null,
          limit: 2,
          maxBytes: 4096,
        }),
      );
      assert.deepEqual(
        result.receipts.map(({ checkpointRevision }) => checkpointRevision),
        [count, count - 1],
      );
      assert.equal(result.nextCursor.revision, count - 2);
      assert.ok(work.readBytes > 0 && work.readBytes <= snapshot.limits.pageBytes);
      assert.equal(work.writeBytes, 0);
      costs.push(work.readBytes);
      t.diagnostic(JSON.stringify({ count, checkpointPageReadBytes: work.readBytes }));
    });
  }
  assert.ok(costs[1] <= costs[0] * 1.25 + 16 * 1024);
});

test("exhausted checkpoint page budget rejects atomically and allows retry with the original cursor", async (t) => {
  const limit = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit;
  const { journal, root, reader } = await seedCheckpoints(t, limit + 10, 16 * 1024);
  await journal.usingSnapshot(async (snapshot) => {
    const options = {
      snapshot,
      turnScopeId: scope.turnScopeId,
      cursor: null,
      limit,
      maxBytes: snapshot.limits.pageBytes,
    };
    const { work } = await observeStorageIo(root, () =>
      assert.rejects(reader.readCheckpointPage(options), { code: "SESSION_QUERY_BUDGET" }),
    );
    assert.ok(work.readBytes <= snapshot.limits.pageBytes);
    assert.equal(work.writeBytes, 0);
    assert.equal(options.cursor, null);
    const page = await reader.readCheckpointPage({ ...options, limit: 1 });
    assert.equal(page.receipts[0].checkpointRevision, limit + 10);
    assert.equal(page.nextCursor.revision, limit + 9);
    const single = { ...options, limit: 1 };
    const bytes = Buffer.byteLength(JSON.stringify(page));
    const { work: resultWork } = await observeStorageIo(root, () =>
      assert.rejects(reader.readCheckpointPage({ ...single, maxBytes: bytes - 1 }), {
        code: "SESSION_QUERY_BUDGET",
        message: "Entity results exceed byte budget",
      }),
    );
    assert.ok(resultWork.readBytes <= snapshot.limits.pageBytes);
    assert.equal(resultWork.writeBytes, 0);
    assert.deepEqual(await reader.readCheckpointPage({ ...single, maxBytes: bytes }), page);
  });
});
