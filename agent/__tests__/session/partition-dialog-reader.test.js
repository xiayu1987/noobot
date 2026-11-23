/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { readImmutableTurnMutationSource } from "../../src/session/services/session-message-service/immutable-turn-source.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

function natural(sessionId, key, identity = scope) {
  const {
    modelMessageId: _model,
    presentationMessageId: _presentation,
    ...fields
  } = message(sessionId, key);
  return { ...fields, ...identity, role: "user", userMessageId: key, messageOrigin: "natural" };
}

function open(journal, sessionId) {
  return openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
}

test("dialog facts preserve first occurrence and anchor across snapshot, append, retry and restart", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  await repository.commit(
    await prepare(journal, repository, "seed-dialogs", {
      messages: [
        message(sessionId, "assistant"),
        natural(sessionId, "other-user", other),
        natural(sessionId, "first-user"),
      ],
    }),
  );
  const expected = { ...scope, dialogOrdinal: 1, userMessageUid: "first-user" };
  {
    await using before = await open(journal, sessionId);
    assert.deepEqual(await before.readDialog(scope.dialogProcessId), expected);
    assert.deepEqual(await before.readDialog(other.dialogProcessId), {
      ...other,
      dialogOrdinal: 2,
      userMessageUid: "other-user",
    });
    assert.equal(await before.readDialog("missing"), null);
    await assert.rejects(before.readDialog(" invalid"), TypeError);
    const request = await prepare(journal, repository, "continue-dialog", {
      messages: [natural(sessionId, "later-user", { ...scope, turnScopeId: "continued-turn" })],
    });
    const committed = await repository.commit(request);
    assert.deepEqual(await repository.commit(request), { ...committed, replayed: true });
    await using after = await open(journal, sessionId);
    assert.deepEqual(await after.readDialog(scope.dialogProcessId), expected);
    const source = await readImmutableTurnMutationSource(after, { turnScopeId: "continued-turn" });
    assert.equal(source.messages[0].messageUid, "later-user");
    assert.deepEqual(await before.readDialog(scope.dialogProcessId), expected);
  }
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const reader = await open(reopened, sessionId);
  assert.deepEqual(await reader.readDialog(scope.dialogProcessId), expected);
  await reader.close();
  await assert.rejects(reader.readDialog(scope.dialogProcessId), { code: "SESSION_READER_CLOSED" });
});

test("suffix deletion clears a removed first user anchor and removes only empty dialogs", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const continuation = { ...scope, turnScopeId: "continued-turn" };
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [
        message(sessionId, "retained"),
        natural(sessionId, "first-user", continuation),
        natural(sessionId, "other-user", other),
      ],
    }),
  );
  await using before = await open(journal, sessionId);
  const request = await prepare(journal, repository, "delete", {
    messageDeletion: {
      commandId: "delete",
      anchor: { turnScopeId: continuation.turnScopeId },
    },
  });
  const deleted = await repository.commit(request);
  assert.deepEqual(await repository.commit(request), { ...deleted, replayed: true });
  await using current = await open(journal, sessionId);
  assert.deepEqual(await current.readDialog(scope.dialogProcessId), {
    ...scope,
    dialogOrdinal: 1,
    userMessageUid: "",
  });
  assert.equal(await current.readDialog(other.dialogProcessId), null);
  assert.equal((await before.readDialog(scope.dialogProcessId)).userMessageUid, "first-user");
  await repository.commit(
    await prepare(journal, repository, "append", { messages: [natural(sessionId, "new-user")] }),
  );
  await using appended = await open(journal, sessionId);
  assert.equal((await appended.readDialog(scope.dialogProcessId)).userMessageUid, "new-user");
});

test("replacement atomically publishes a fresh dialog ordinal and preserves the retained reader", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", { messages: [natural(sessionId, "user")] }),
  );
  const request = await prepare(journal, repository, "replace", {
    turnReplacement: {
      command: {
        commandId: "replace",
        anchor: { turnScopeId: scope.turnScopeId },
        turnScopeId: "replacement-turn",
        newContent: "replacement",
        attachments: [],
      },
      identity: {
        dialogProcessId: "replacement-dialog",
        messageUid: "replacement-message",
        userMessageId: "replacement-user",
      },
    },
  });
  const expected = {
    dialogProcessId: "replacement-dialog",
    turnScopeId: "replacement-turn",
    dialogOrdinal: 2,
    userMessageUid: "replacement-message",
  };
  {
    await using before = await open(journal, sessionId);
    const replaced = await repository.commit(request);
    assert.deepEqual(await repository.commit(request), { ...replaced, replayed: true });
    await using current = await open(journal, sessionId);
    assert.equal(await current.readDialog(scope.dialogProcessId), null);
    assert.deepEqual(await current.readDialog(expected.dialogProcessId), expected);
    assert.equal(await before.readDialog(expected.dialogProcessId), null);
    assert.equal((await before.readDialog(scope.dialogProcessId)).userMessageUid, "user");
  }
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using reader = await open(reopened, sessionId);
  assert.deepEqual(await reader.readDialog(expected.dialogProcessId), expected);
  assert.equal(await reader.readDialog(scope.dialogProcessId), null);
});

test("malformed dialog facts reject reads and appends without publishing inferred replacements", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {}, { autoClose: false });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", { messages: [message(sessionId, "m1")] }),
  );
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const entry = (
      await transactions.lookupLatestMany({
        snapshot,
        collection: "dialogs",
        keys: [scope.dialogProcessId],
      })
    ).get(scope.dialogProcessId);
    await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "corrupt-dialog",
      input: {},
      result: null,
      mutations: [
        { collection: "dialogs", key: scope.dialogProcessId, owner: entry.owner, value: null },
      ],
    });
  });
  await using reader = await open(journal, sessionId);
  await assert.rejects(reader.readDialog(scope.dialogProcessId), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  const publications = journal.work.publications;
  const request = await prepare(journal, repository, "append", {
    messages: [message(sessionId, "m2")],
  });
  await assert.rejects(repository.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
  assert.equal(journal.work.publications, publications);
  await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
});
