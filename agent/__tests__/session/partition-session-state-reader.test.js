/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { partitionMessageEntryKey } from "@noobot/session-protocol/partition-session-messages";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

async function acceptTurn(journal, sessionId) {
  const messages = openTestMessages(journal, sessionId);
  const turnTransition = {
    ...scope,
    sessionId,
    commandId: "accept-command",
    causationId: "accept-command",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation-m1",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  };
  return messages.commit(
    await prepare(journal, messages, "accept", {
      messages: [
        {
          ...scope,
          sessionId,
          messageUid: "m1",
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content: "body",
          attachments: [],
          ts: committedAt,
          pending: true,
          turnCommit: { action: "send", commandId: turnTransition.commandId },
        },
      ],
      turnTransition,
    }),
  );
}

async function mutate(journal, collection, key, change) {
  const transactions = new PartitionTransactions(journal);
  const mutation = await journal.usingSnapshot((snapshot) =>
    transactions.withCollectionReader(snapshot, async (read) => {
      const stored = (await read({ collection, keys: [key], includeOwner: true })).get(key);
      return { collection, key, owner: stored.owner, ...change(stored.mutation.value) };
    }),
  );
  return commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: `mutate-${journal.head.sequence}`,
    input: null,
    mutations: [mutation],
    result: null,
  });
}

test("partition state port keeps lifecycle and command reads on its retained generation", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 8 * 1024 });
  let escaped;
  {
    await using before = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    escaped = before;
    const original = await before.readLifecycleHead();
    assert.equal(await before.readTurnState(scope.turnScopeId), null);
    assert.equal(await before.readTurnDescriptor(scope.turnScopeId), null);
    assert.equal(await before.readCommand("accept-command"), null);
    const committed = await acceptTurn(journal, sessionId);
    assert.deepEqual(await before.readLifecycleHead(), original);
    assert.equal(await before.readTurnState(scope.turnScopeId), null);
    assert.equal(await before.readTurnDescriptor(scope.turnScopeId), null);
    assert.equal(await before.readCommand("accept-command"), null);
    await using current = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    const transition = committed.result.turnTransition;
    assert.deepEqual(await current.readLifecycleHead(), transition.header);
    assert.deepEqual(await current.readTurnState(scope.turnScopeId), transition.turn);
    assert.deepEqual(await current.readTurnDescriptor(scope.turnScopeId), {
      ...scope,
      messageCount: 1,
    });
    assert.equal(await current.readTurnDescriptor("missing"), null);
    await assert.rejects(current.readTurnDescriptor(" turn-1"), TypeError);
    assert.deepEqual(await current.readCommand("accept-command"), transition.commandReceipt);
    assert.equal(await current.readTurnState("missing"), null);
    assert.equal(await current.readCommand("missing"), null);
    await assert.rejects(current.readTurnState(" turn-1"), TypeError);
    await assert.rejects(current.readCommand(" accept-command"), TypeError);
  }
  for (const [method, argument] of [
    ["readLifecycleHead"],
    ["readTurnState", scope.turnScopeId],
    ["readTurnDescriptor", scope.turnScopeId],
    ["readCommand", "accept-command"],
  ])
    await assert.rejects(escaped[method](argument), { code: "SESSION_READER_CLOSED" });
});

test("retired lifecycle is absent while the retained message prefix and command receipt remain readable", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 8 * 1024 });
  const committed = await acceptTurn(journal, sessionId);
  await using before = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  await mutate(journal, "metadata", "lifecycle", (value) => ({
    value: { ...value, activeTurnScopeId: "" },
  }));
  await mutate(journal, "lifecycle", scope.turnScopeId, () => ({ remove: true }));
  await using current = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  assert.deepEqual(
    await before.readTurnState(scope.turnScopeId),
    committed.result.turnTransition.turn,
  );
  assert.equal(await current.readTurnState(scope.turnScopeId), null);
  assert.equal((await current.readMessageEntry({ messageUid: "m1" })).message.messageUid, "m1");
  assert.deepEqual(
    await current.readTurnDescriptor(scope.turnScopeId),
    await before.readTurnDescriptor(scope.turnScopeId),
  );
  assert.deepEqual(
    await current.readCommand("accept-command"),
    committed.result.turnTransition.commandReceipt,
  );
});

for (const [label, collection, key, change, method, argument] of [
  [
    "invalid lifecycle header",
    "metadata",
    "lifecycle",
    (value) => ({ value: { ...value, sequence: -1 } }),
    "readLifecycleHead",
  ],
  [
    "missing active state",
    "metadata",
    "lifecycle",
    (value) => ({ value: { ...value, activeTurnScopeId: "missing" } }),
    "readLifecycleHead",
  ],
  [
    "state beyond lifecycle sequence",
    "metadata",
    "lifecycle",
    (value) => ({ value: { ...value, sequence: 0 } }),
    "readTurnState",
    scope.turnScopeId,
  ],
  [
    "command receipt identity mismatch",
    "commands",
    "accept-command",
    (value) => ({ value: { ...value, commandId: "foreign" } }),
    "readCommand",
    "accept-command",
  ],
  [
    "invalid turn membership count",
    "turns",
    scope.turnScopeId,
    (value) => ({ value: { ...value, messageCount: 0 } }),
    "readTurnDescriptor",
    scope.turnScopeId,
  ],
  [
    "turn membership ownership mismatch",
    "turns",
    scope.turnScopeId,
    (value) => ({ value: { ...value, dialogProcessId: "foreign" } }),
    "readTurnDescriptor",
    scope.turnScopeId,
  ],
  [
    "missing turn anchor",
    "turnMessages",
    partitionMessageEntryKey("turnMessages", scope.turnScopeId, 1),
    () => ({ remove: true }),
    "readTurnDescriptor",
    scope.turnScopeId,
  ],
]) {
  test(`partition state reads reject ${label}`, async (t) => {
    const { journal, sessionId } = await createMessageCase(t, { transactionBytes: 8 * 1024 });
    await acceptTurn(journal, sessionId);
    await mutate(journal, collection, key, change);
    const head = journal.head;
    await using reader = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    await assert.rejects(reader[method](argument), { code: "SESSION_STORAGE_CORRUPT" });
    assert.equal(journal.head, head);
  });
}

const stateCommands = {
  lifecycle: (sessionId) => ({
    turnTransition: {
      ...scope,
      sessionId,
      commandId: "processing-command",
      causationId: "processing-command",
      eventType: "turn.processing_started",
      phase: "processing",
    },
  }),
  deletion: () => ({
    messageDeletion: {
      commandId: "delete-command",
      anchor: { turnScopeId: scope.turnScopeId },
    },
  }),
  replacement: () => ({
    turnReplacement: {
      command: {
        commandId: "replace-command",
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
};

for (const [kind, command] of Object.entries(stateCommands)) {
  for (const [label, change] of [
    ["negative sequence", (value) => ({ value: { ...value, sequence: -1 } })],
    ["invalid outbox tail", (value) => ({ value: { ...value, outboxTail: -1 } })],
    ["removed header", () => ({ remove: true })],
  ]) {
    test(`partition ${kind} rejects ${label} without publishing`, async (t) => {
      const { journal, sessionId } = await createMessageCase(
        t,
        { transactionBytes: 8 * 1024 },
        { autoClose: false },
      );
      await acceptTurn(journal, sessionId);
      await mutate(journal, "metadata", "lifecycle", change);
      const repository = openTestMessages(journal, sessionId);
      const request = await prepare(journal, repository, "reject-corruption", command(sessionId));
      const head = journal.head;
      const publications = journal.work.publications;
      await assert.rejects(repository.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
      assert.equal(journal.head, head);
      assert.equal(journal.work.publications, publications);
      await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
    });
  }

  test(`partition ${kind} rejects a foreign command receipt instead of replaying or publishing`, async (t) => {
    const { journal, sessionId } = await createMessageCase(
      t,
      { transactionBytes: 8 * 1024 },
      { autoClose: false },
    );
    await acceptTurn(journal, sessionId);
    const repository = openTestMessages(journal, sessionId);
    const changes = command(sessionId);
    const commandId =
      changes.turnTransition?.commandId ??
      changes.messageDeletion?.commandId ??
      changes.turnReplacement.command.commandId;
    await repository.commit(await prepare(journal, repository, "original-command", changes));
    await mutate(journal, "commands", commandId, (value) => ({
      value: { ...value, commandId: "foreign" },
    }));
    const request = await prepare(journal, repository, "replayed-command", changes);
    const head = journal.head;
    const publications = journal.work.publications;
    await assert.rejects(repository.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
    assert.equal(journal.head, head);
    assert.equal(journal.work.publications, publications);
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  });
}
