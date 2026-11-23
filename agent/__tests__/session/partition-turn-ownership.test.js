/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { partitionMessageEntryKey } from "@noobot/session-protocol/partition-session-messages";
import { PartitionSessionMessages } from "../../src/session/partition-storage/partition-session-messages.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";

const committedAt = "2026-11-20T00:00:00.000Z";
const turnScopeId = "turn";

function message(sessionId, messageUid, dialogProcessId = "dialog") {
  return {
    sessionId,
    parentSessionId: "",
    dialogProcessId,
    turnScopeId,
    messageUid,
    modelMessageId: `model-${messageUid}`,
    presentationMessageId: `presentation-${messageUid}`,
    role: "assistant",
    type: "message",
    content: messageUid,
    attachments: [],
    ts: committedAt,
  };
}

function transition(sessionId, commandId, dialogProcessId = "dialog") {
  return {
    sessionId,
    dialogProcessId,
    turnScopeId,
    commandId,
    causationId: commandId,
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation",
    executionId: "agent:turn",
    executionKind: "agent",
    rootExecutionId: "agent:turn",
  };
}

function prepare(journal, repository, operationId, changes) {
  return journal.usingSnapshot((snapshot) =>
    repository.prepareRequest(snapshot, { operationId, committedAt, changes }),
  );
}

async function fixture(t) {
  const result = await createTransactionCase(t, { transactionBytes: 16 * 1024 });
  const { journal, sessionId } = result;
  const scope = { sessionId, parentSessionId: "" };
  await initializePartitionSession(journal, scope, committedAt);
  return { ...result, repository: new PartitionSessionMessages(journal, scope) };
}

test("mixed message and lifecycle ownership conflict rejects the whole request", async (t) => {
  const { journal, repository, sessionId, root } = await fixture(t);
  const before = await readFile(`${root}/CURRENT`);
  const invalid = await prepare(journal, repository, "foreign", {
    messages: [message(sessionId, "bad")],
    turnTransition: transition(sessionId, "foreign", "other-dialog"),
  });
  await assert.rejects(repository.commit(invalid), { code: "SESSION_TURN_IDENTITY_CONFLICT" });
  assert.deepEqual(await readFile(`${root}/CURRENT`), before);
  await journal.usingSnapshot(async (snapshot) => {
    assert.deepEqual(
      await repository.readSessionMessageOrderPage({ snapshot, cursor: null, limit: 8 }),
      { entries: [], nextCursor: null },
    );
    assert.deepEqual(
      (await repository.readOutboxPage({ snapshot, consumerId: "consumer", after: 0, limit: 8 }))
        .events,
      [],
    );
  });
});

for (const first of ["messages", "turnTransition"]) {
  test(`cold ${first} owner prevents a foreign counterpart and allows a matching retry`, async (t) => {
    const { journal, repository, sessionId, root } = await fixture(t);
    const seed =
      first === "messages"
        ? { messages: [message(sessionId, "seed")] }
        : { turnTransition: transition(sessionId, "seed") };
    await repository.commit(await prepare(journal, repository, "seed", seed));
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const reader = new PartitionSessionMessages(cold, { sessionId, parentSessionId: "" });
    const delta = (dialogProcessId) =>
      first === "messages"
        ? { turnTransition: transition(sessionId, "counterpart", dialogProcessId) }
        : { messages: [message(sessionId, "counterpart", dialogProcessId)] };
    const before = await readFile(`${root}/CURRENT`);
    await assert.rejects(
      reader.commit(await prepare(cold, reader, "foreign", delta("other-dialog"))),
      { code: "SESSION_TURN_IDENTITY_CONFLICT" },
    );
    assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    const request = await prepare(cold, reader, "matching", delta("dialog"));
    const committed = await reader.commit(request);
    const published = await readFile(`${root}/CURRENT`);
    assert.deepEqual(await reader.commit(request), { ...committed, replayed: true });
    assert.deepEqual(await readFile(`${root}/CURRENT`), published);
    await cold.usingSnapshot(async (snapshot) => {
      const page = await reader.readTurnPage({
        snapshot,
        dialogProcessId: "dialog",
        turnScopeId,
        cursor: null,
        limit: 8,
      });
      assert.deepEqual(
        page.entries.map(({ message }) => message.messageUid),
        [first === "messages" ? "seed" : "counterpart"],
      );
    });
  });
}

test("batch ownership rejection preserves accepted neighbors and staged ownership", async (t) => {
  const { journal, repository, sessionId } = await fixture(t);
  const first = await prepare(journal, repository, "first", {
    messages: [message(sessionId, "first")],
  });
  const invalid = await prepare(journal, repository, "foreign", {
    turnTransition: transition(sessionId, "foreign", "other-dialog"),
  });
  const healthy = await prepare(journal, repository, "healthy", {
    turnTransition: transition(sessionId, "healthy"),
  });
  const outcomes = await Promise.allSettled([
    repository.commit(first),
    repository.commit({ ...invalid, expectedGeneration: first.expectedGeneration + 1 }),
    repository.commit({ ...healthy, expectedGeneration: first.expectedGeneration + 1 }),
  ]);
  assert.deepEqual(
    outcomes.map(({ status }) => status),
    ["fulfilled", "rejected", "fulfilled"],
  );
  assert.equal(outcomes[1].reason.code, "SESSION_TURN_IDENTITY_CONFLICT");
  await journal.usingSnapshot(async (snapshot) => {
    const page = await repository.readTurnPage({
      snapshot,
      dialogProcessId: "dialog",
      turnScopeId,
      cursor: null,
      limit: 8,
    });
    assert.deepEqual(
      page.entries.map(({ message }) => message.messageUid),
      ["first"],
    );
    assert.equal(
      (await repository.readOutboxPage({ snapshot, consumerId: "consumer", after: 0, limit: 8 }))
        .events.length,
      1,
    );
  });
});

for (const [name, collection, damage] of [
  ["membership shape", "turns", () => null],
  ["membership count", "turns", (value) => ({ ...value, messageCount: 0 })],
  ["lifecycle shape", "lifecycle", () => null],
  ["turn position", "turnMessages", () => "foreign-message"],
  ["lifecycle revision", "lifecycle", (value) => ({ ...value, revision: 0 })],
  ["lifecycle key", "lifecycle", (value) => ({ ...value, turnScopeId: "foreign-turn" })],
  [
    "cross-collection ownership",
    "lifecycle",
    (value) => ({ ...value, dialogProcessId: "foreign-dialog" }),
  ],
]) {
  for (const operation of [
    "read",
    "create",
    "append",
    "replace",
    "metadata",
    "checkpoint",
    "checkpoint replay",
    ...(collection === "turnMessages"
      ? []
      : ["checkpoint context", "checkpoint context replay", "checkpoint empty"]),
  ]) {
    test(`cold message ${operation} rejects corrupt ${name} without publication`, async (t) => {
      const { journal, repository, sessionId, root } = await fixture(t);
      const seeded = await repository.commit(
        await prepare(journal, repository, "seed", {
          messages: [message(sessionId, "seed")],
          turnTransition: transition(sessionId, "seed"),
        }),
      );
      if (operation.startsWith("checkpoint context"))
        await repository.commit(
          await prepare(journal, repository, "history", {
            messages: [{ ...message(sessionId, "history"), turnScopeId: "history-turn" }],
          }),
        );
      const summary = {
        sessionId,
        turnScopeId,
        dialogProcessId: "dialog",
        userId: "admin",
        checkpointId: "summary",
        expectedCheckpointRevision: 0,
        messages: [],
        persistedMessageUids: [],
        summarizedMessageUids:
          operation === "checkpoint empty"
            ? []
            : [operation.startsWith("checkpoint context") ? "history" : "seed"],
        retainedMessageUids: [],
      };
      if (operation.endsWith(" replay"))
        await repository.commit(
          await prepare(journal, repository, "summarize", { summaryCheckpoints: [summary] }),
        );
      const transactions = new PartitionTransactions(journal);
      const damagedKey =
        collection === "turnMessages"
          ? partitionMessageEntryKey(collection, turnScopeId, 1)
          : turnScopeId;
      await journal.usingSnapshot(async (snapshot) => {
        const stored = (
          await transactions.lookupLatestMany({ snapshot, collection, keys: [damagedKey] })
        ).get(damagedKey);
        const record = (
          await transactions.getLatestMany({ snapshot, collection, keys: [damagedKey] })
        ).get(damagedKey);
        await commitFixtureTransaction(transactions, {
          epoch: snapshot.epoch,
          expectedGeneration: snapshot.sequence,
          sequence: snapshot.sequence + 1,
          operationId: "damage",
          input: {},
          result: null,
          mutations: [
            {
              collection,
              key: damagedKey,
              owner: stored.owner,
              value: damage(record.value),
            },
          ],
        });
      });
      await journal.close();
      const cold = await PartitionJournal.open({ root, sessionId });
      t.after(() =>
        operation === "read"
          ? cold.close()
          : assert.rejects(cold.close(), {
              code: "SESSION_STORAGE_CORRUPT",
            }),
      );
      const reader = new PartitionSessionMessages(cold, { sessionId, parentSessionId: "" });
      const before = await readFile(`${root}/CURRENT`);
      const identity = {
        dialogProcessId: "dialog",
        turnScopeId,
        messageUid: "seed",
      };
      const { owner, contentReference } = seeded.result.messageReceipts[0];
      if (operation === "read") {
        await assert.rejects(
          cold.usingSnapshot((snapshot) =>
            reader.readTurnPage({
              snapshot,
              dialogProcessId: "dialog",
              turnScopeId,
              cursor: null,
              limit: 8,
            }),
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
        await assert.rejects(
          cold.usingSnapshot((snapshot) =>
            reader.readContentPage({
              snapshot,
              ...identity,
              contentReference,
              cursor: null,
              limit: 1,
            }),
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
        await assert.rejects(
          cold.usingSnapshot((snapshot) =>
            reader.readSessionMessageOrderPage({
              snapshot,
              cursor: null,
              limit: 1,
            }),
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
        await assert.rejects(
          cold.usingSnapshot((snapshot) =>
            reader.readMessageSuffixPage({
              snapshot,
              turnScopeId,
              cursor: null,
              limit: 1,
            }),
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
      } else if (operation.startsWith("checkpoint")) {
        const request = await prepare(cold, reader, "checkpoint-damaged-turn", {
          sessionMetadata: { customTitle: "must not publish" },
          summaryCheckpoints: [summary],
        });
        await assert.rejects(reader.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
      } else {
        const field = {
          append: "messageContentAppends",
          replace: "messageContentReplacements",
          metadata: "messageMetadataUpdates",
        }[operation];
        const changes = {
          sessionMetadata: { customTitle: "must not publish" },
          ...(operation === "create"
            ? { messages: [message(sessionId, "new-message")] }
            : {
                [field]: [
                  {
                    ...identity,
                    owner,
                    expectedContentReference: contentReference,
                    ...(operation === "metadata"
                      ? { metadata: { summarized: true }, metadataRemovals: [] }
                      : { content: "must not publish" }),
                  },
                ],
              }),
        };
        const request = await prepare(cold, reader, "write-damaged-turn", changes);
        await assert.rejects(reader.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
      }
      assert.deepEqual(await readFile(`${root}/CURRENT`), before);
    });
  }
}
