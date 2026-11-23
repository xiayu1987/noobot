/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { withSessionDialogMessageRecords } from "../../src/session/services/session-message-service/dialog-message-stream.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

function open(journal, sessionId) {
  return openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
}

async function members(reader, dialogProcessId, limit = 1) {
  const ids = [];
  let after = 0;
  let page;
  do {
    page = await reader.readDialogTurnPage({ dialogProcessId, after, limit });
    if (page === null) return null;
    ids.push(...page.turnScopeIds);
    after = page.cursor;
  } while (page.hasMore);
  return ids;
}

test("partition dialog business stream uses pinned ordered membership across append, deletion and restart", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repo = openTestMessages(journal, sessionId);
  const m = (uid, turnScopeId = scope.turnScopeId) => ({ ...message(sessionId, uid), turnScopeId });
  await repo.commit(
    await prepare(journal, repo, "seed", { messages: [m("a"), m("b", "second"), m("c")] }),
  );
  {
    await using pinned = await open(journal, sessionId);
    assert.deepEqual(await members(pinned, scope.dialogProcessId), [scope.turnScopeId, "second"]);
    assert.equal(await members(pinned, "absent"), null);
    await assert.rejects(
      pinned.readDialogTurnPage({ dialogProcessId: scope.dialogProcessId, after: 3 }),
      TypeError,
    );
    await assert.rejects(
      pinned.readDialogTurnPage({ dialogProcessId: scope.dialogProcessId, maxBytes: 1 }),
      { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" },
    );
    const context = {
      sessionRepo: {
        withSessionLifecycleMutation(_userId, _sessionId, consume) {
          return consume();
        },
        requireSessionReader: () => open(journal, sessionId),
      },
    };
    const streamed = await withSessionDialogMessageRecords.call(
      context,
      { userId: "admin", sessionId, dialogProcessId: scope.dialogProcessId },
      async (records) => {
        const uids = [];
        for await (const { message } of records) {
          uids.push(message.messageUid);
          if (uids.length === 1)
            await repo.commit(
              await prepare(journal, repo, "append", { messages: [m("later", "third")] }),
            );
        }
        return uids;
      },
    );
    assert.deepEqual(streamed, ["a", "c", "b"]);
    await using appended = await open(journal, sessionId);
    assert.deepEqual(await members(appended, scope.dialogProcessId), [
      scope.turnScopeId,
      "second",
      "third",
    ]);
    await repo.commit(
      await prepare(journal, repo, "delete", {
        messageDeletion: { commandId: "delete", anchor: { turnScopeId: "second" } },
      }),
    );
    await using deleted = await open(journal, sessionId);
    assert.deepEqual(await members(deleted, scope.dialogProcessId), [scope.turnScopeId]);
    assert.deepEqual(await members(pinned, scope.dialogProcessId), [scope.turnScopeId, "second"]);
    await repo.commit(
      await prepare(journal, repo, "reuse-position", { messages: [m("new", "fourth")] }),
    );
    await using current = await open(journal, sessionId);
    assert.deepEqual(await members(current, scope.dialogProcessId), [scope.turnScopeId, "fourth"]);
  }
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using reader = await open(reopened, sessionId);
  assert.deepEqual(await members(reader, scope.dialogProcessId), [scope.turnScopeId, "fourth"]);
});

test("replacement publishes dialog membership atomically and replay does not allocate another position", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repo = openTestMessages(journal, sessionId);
  const {
    modelMessageId: _model,
    presentationMessageId: _presentation,
    ...fields
  } = message(sessionId, "user");
  await repo.commit(
    await prepare(journal, repo, "seed", {
      messages: [{ ...fields, role: "user", userMessageId: "user", messageOrigin: "natural" }],
    }),
  );
  await using pinned = await open(journal, sessionId);
  const request = await prepare(journal, repo, "replace", {
    turnReplacement: {
      command: {
        commandId: "replace",
        anchor: { turnScopeId: scope.turnScopeId },
        turnScopeId: "replacement",
        newContent: "new",
        attachments: [],
      },
      identity: {
        dialogProcessId: "new-dialog",
        messageUid: "new-message",
        userMessageId: "new-user",
      },
    },
  });
  const result = await repo.commit(request);
  assert.deepEqual(await repo.commit(request), { ...result, replayed: true });
  await using current = await open(journal, sessionId);
  assert.equal(await members(current, scope.dialogProcessId), null);
  assert.deepEqual(await members(current, "new-dialog"), ["replacement"]);
  assert.deepEqual(await members(pinned, scope.dialogProcessId), [scope.turnScopeId]);
  assert.equal(await members(pinned, "new-dialog"), null);
});

for (const [collection, identity] of [
  ["dialogTurns", scope.dialogProcessId],
  ["turnMessages", scope.turnScopeId],
])
  test(`fresh scope publication rejects an occupied ${collection} position`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
    const repo = openTestMessages(journal, sessionId);
    const tx = new PartitionTransactions(journal);
    const key = JSON.stringify([identity, 1]);
    await journal.usingSnapshot((snapshot) =>
      commitFixtureTransaction(tx, {
        epoch: snapshot.epoch,
        expectedGeneration: snapshot.sequence,
        sequence: snapshot.sequence + 1,
        operationId: "occupy-position",
        input: {},
        result: null,
        mutations: [{ collection, key, owner: null, value: "occupied" }],
      }),
    );
    const publications = journal.work.publications;
    const request = await prepare(journal, repo, "create-dialog", {
      messages: [message(sessionId, "m1")],
    });
    await assert.rejects(repo.commit(request), { code: "SESSION_ENTITY_EXISTS" });
    assert.equal(journal.work.publications, publications);
    await journal.usingSnapshot(async (snapshot) => {
      const positions = await tx.getLatestMany({ snapshot, collection, keys: [key] });
      assert.equal(positions.get(key).value, "occupied");
    });
  });

test("missing dialog member rejects reads and suffix deletion without scanning or publication", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {}, { autoClose: false });
  const repo = openTestMessages(journal, sessionId);
  await repo.commit(await prepare(journal, repo, "seed", { messages: [message(sessionId, "m1")] }));
  const tx = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const key = JSON.stringify([scope.dialogProcessId, 1]);
    const stored = (
      await tx.lookupLatestMany({ snapshot, collection: "dialogTurns", keys: [key] })
    ).get(key);
    await commitFixtureTransaction(tx, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "corrupt",
      input: {},
      result: null,
      mutations: [{ collection: "dialogTurns", key, owner: stored.owner, remove: true }],
    });
  });
  {
    await using reader = await open(journal, sessionId);
    await assert.rejects(reader.readDialogTurnPage({ dialogProcessId: scope.dialogProcessId }), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    const request = await prepare(journal, repo, "delete", {
      messageDeletion: { commandId: "delete", anchor: { turnScopeId: scope.turnScopeId } },
    });
    const publications = journal.work.publications;
    await assert.rejects(repo.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
    assert.equal(journal.work.publications, publications);
  }
  await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
});
