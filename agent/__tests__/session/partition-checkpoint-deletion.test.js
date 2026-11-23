/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  scope,
  message,
  prepare,
  openTestMessages,
  createMessageCase,
} from "./partition-session-messages.test-helpers.js";

function checkpoint(sessionId, messageUid, checkpointId, expectedCheckpointRevision = 0) {
  return {
    ...scope,
    sessionId,
    userId: "admin",
    checkpointId,
    expectedCheckpointRevision,
    messages: [],
    persistedMessageUids: [],
    summarizedMessageUids: [messageUid],
    retainedMessageUids: [],
  };
}

async function stored(journal, collection, keys, snapshot) {
  const transactions = new PartitionTransactions(journal);
  const read = (current) => transactions.getLatestMany({ snapshot: current, collection, keys });
  return snapshot ? read(snapshot) : journal.usingSnapshot(read);
}

test("real deletion removes checkpoint facts atomically and preserves cold operation replay", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const summary = checkpoint(sessionId, "source", "summary");
  const summarized = await prepare(journal, repository, "summarize", {
    messages: [message(sessionId, "source")],
    summaryCheckpoints: [summary],
  });
  const original = await repository.commit(summarized);
  const deletion = await prepare(journal, repository, "delete", {
    messageDeletion: { commandId: "delete", anchor: { turnScopeId: scope.turnScopeId } },
  });
  const key = JSON.stringify([scope.turnScopeId, summary.checkpointId]);
  await journal.usingSnapshot(async (snapshot) => {
    const publications = journal.work.publications;
    await repository.commit(deletion);
    assert.equal(journal.work.publications, publications + 1);
    assert.equal(
      (await stored(journal, "checkpoints", [key], snapshot)).get(key).value.checkpointId,
      "summary",
    );
    for (const [collection, identity] of [
      ["checkpointHeads", scope.turnScopeId],
      ["turnCheckpoints", scope.turnScopeId],
      ["checkpoints", key],
      ["checkpointOrder", JSON.stringify([scope.turnScopeId, 1])],
    ]) {
      assert.equal((await stored(journal, collection, [identity])).get(identity).remove, true);
    }
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = openTestMessages(reopened, sessionId);
  const before = reopened.head.sequence;
  assert.deepEqual(await cold.commit(summarized), { ...original, replayed: true });
  await assert.rejects(
    cold.commit(await prepare(reopened, cold, "stale", { summaryCheckpoints: [summary] })),
    { code: "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING" },
  );
  assert.equal(reopened.head.sequence, before);
  await assert.rejects(
    cold.commit(
      await prepare(reopened, cold, "recreate", {
        messages: [message(sessionId, "new-source")],
      }),
    ),
    { code: "SESSION_ENTITY_EXISTS" },
  );
  assert.equal(reopened.head.sequence, before);
});

test("interleaved deletion keeps prefix receipts and revision while removing receipts for the suffix", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const prefix = checkpoint(sessionId, "retained", "prefix");
  const suffix = checkpoint(sessionId, "removed", "suffix", 1);
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [
        message(sessionId, "retained"),
        { ...message(sessionId, "anchor"), turnScopeId: "other-turn" },
        message(sessionId, "removed"),
      ],
      summaryCheckpoints: [prefix, suffix, checkpoint(sessionId, "retained", "latest-prefix", 2)],
    }),
  );
  await repository.commit(
    await prepare(journal, repository, "delete", {
      messageDeletion: { commandId: "delete", anchor: { turnScopeId: "other-turn" } },
    }),
  );
  const keys = ["prefix", "suffix"].map((id) => JSON.stringify([scope.turnScopeId, id]));
  const receipts = await stored(journal, "checkpoints", keys);
  assert.equal(receipts.get(keys[0]).value.checkpointId, "prefix");
  assert.equal(receipts.get(keys[1]).remove, true);
  const orderKey = JSON.stringify([scope.turnScopeId, 3]);
  assert.deepEqual((await stored(journal, "checkpointOrder", [orderKey])).get(orderKey).value, {
    checkpointId: "latest-prefix",
    previousRevision: 1,
  });
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const cold = openTestMessages(reopened, sessionId);
  const duplicate = await cold.commit(
    await prepare(reopened, cold, "repeat-prefix", {
      summaryCheckpoints: [prefix],
    }),
  );
  assert.equal(duplicate.result.summaryCheckpoints[0].committed, false);
  const next = await cold.commit(
    await prepare(reopened, cold, "next", {
      messages: [message(sessionId, "appended")],
      summaryCheckpoints: [checkpoint(sessionId, "appended", "suffix", 3)],
    }),
  );
  assert.equal(next.result.summaryCheckpoints[0].checkpointRevision, 4);
});

test("failed deletion publication preserves checkpoints and cold retry retires them together", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(
    t,
    { transactionBytes: 16 * 1024 },
    { autoClose: false },
  );
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [message(sessionId, "source")],
      summaryCheckpoints: [checkpoint(sessionId, "source", "summary")],
    }),
  );
  const request = await prepare(journal, repository, "delete-fault", {
    messageDeletion: { commandId: "delete-fault", anchor: { turnScopeId: scope.turnScopeId } },
  });
  const before = journal.head.sequence;
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (String(target).endsWith("/CURRENT")) {
        injected = true;
        throw new Error("checkpoint deletion publication fault");
      }
      return adapter.rename(source, target);
    },
  });
  try {
    await assert.rejects(repository.commit(request), { code: "SESSION_COMMIT_UNCERTAIN" });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.equal(reopened.head.sequence, before);
  const key = JSON.stringify([scope.turnScopeId, "summary"]);
  assert.equal(
    (await stored(reopened, "checkpoints", [key])).get(key).value.checkpointId,
    "summary",
  );
  const cold = openTestMessages(reopened, sessionId);
  const deleted = await cold.commit(request);
  assert.equal((await stored(reopened, "checkpoints", [key])).get(key).remove, true);
  assert.deepEqual(await cold.commit(request), { ...deleted, replayed: true });
});
