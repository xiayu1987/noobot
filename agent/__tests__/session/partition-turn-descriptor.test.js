/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("turn descriptors follow committed suffix membership across append, retry and restart", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  await repository.commit(
    await prepare(journal, repository, "seed-descriptors", {
      messages: [
        message(sessionId, "a1"),
        { ...message(sessionId, "b1"), ...other },
        message(sessionId, "a2"),
      ],
    }),
  );
  const request = await prepare(journal, repository, "delete-descriptors", {
    messageDeletion: {
      commandId: "delete-descriptors",
      anchor: { turnScopeId: other.turnScopeId },
    },
  });
  {
    await using before = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    const deleted = await repository.commit(request);
    await using current = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    assert.deepEqual(await before.readTurnDescriptor(scope.turnScopeId), {
      ...scope,
      messageCount: 2,
    });
    assert.deepEqual(await before.readTurnDescriptor(other.turnScopeId), {
      ...other,
      messageCount: 1,
    });
    assert.deepEqual(await current.readTurnDescriptor(scope.turnScopeId), {
      ...scope,
      messageCount: 1,
    });
    assert.equal(await current.readTurnDescriptor(other.turnScopeId), null);
    assert.deepEqual(await repository.commit(request), { ...deleted, replayed: true });
    await repository.commit(
      await prepare(journal, repository, "append-descriptor", {
        messages: [message(sessionId, "a3")],
      }),
    );
    assert.deepEqual(await current.readTurnDescriptor(scope.turnScopeId), {
      ...scope,
      messageCount: 1,
    });
  }
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using reader = await openPartitionSessionReader({
    journal: reopened,
    sessionId,
    parentSessionId: "",
  });
  assert.deepEqual(await reader.readTurnDescriptor(scope.turnScopeId), {
    ...scope,
    messageCount: 2,
  });
  assert.equal(await reader.readTurnDescriptor(other.turnScopeId), null);
});

test("replacement retires the old descriptor and atomically publishes the replacement descriptor", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const {
    modelMessageId: _model,
    presentationMessageId: _presentation,
    ...natural
  } = message(sessionId, "a1");
  await repository.commit(
    await prepare(journal, repository, "seed-replacement-descriptor", {
      messages: [{ ...natural, role: "user", userMessageId: "a1", messageOrigin: "natural" }],
    }),
  );
  await using before = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  await repository.commit(
    await prepare(journal, repository, "replace-descriptor", {
      turnReplacement: {
        command: {
          commandId: "replace-descriptor",
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
    }),
  );
  await using current = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  assert.deepEqual(await before.readTurnDescriptor(scope.turnScopeId), {
    ...scope,
    messageCount: 1,
  });
  assert.equal(await before.readTurnDescriptor("replacement-turn"), null);
  assert.equal(await current.readTurnDescriptor(scope.turnScopeId), null);
  assert.deepEqual(await current.readTurnDescriptor("replacement-turn"), {
    dialogProcessId: "replacement-dialog",
    turnScopeId: "replacement-turn",
    messageCount: 1,
  });
});
