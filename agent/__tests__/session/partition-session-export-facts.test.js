/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { withPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  observeDirectoryPageReads,
} from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const read = (journal, sessionId, operation) =>
  withPartitionSessionReader({ journal, sessionId, parentSessionId: "" }, operation);
const exported = (journal, sessionId) =>
  read(journal, sessionId, (reader) => reader.exportSession());

async function reopen(t, journal, root, sessionId) {
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  return cold;
}

test("export preserves lifecycle receipts, timing and checkpoint state through the shared reader contracts", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const turnTransition = {
    ...scope,
    sessionId,
    commandId: "accept",
    causationId: "accept",
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    presentationMessageId: "presentation-m1",
    executionId: "agent:turn-1",
    executionKind: "agent",
    rootExecutionId: "agent:turn-1",
  };
  const result = await repository.commit(
    await prepare(journal, repository, "accept", {
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
          turnCommit: { action: "send", commandId: "accept" },
        },
      ],
      turnTransition,
      timings: [{ ...scope, thinkingFinishedAt: committedAt }],
    }),
  );
  await repository.commit(
    await prepare(journal, repository, "checkpoint", {
      messages: [message(sessionId, "answer")],
      summaryCheckpoints: [
        {
          ...scope,
          sessionId,
          userId: "admin",
          checkpointId: "summary",
          expectedCheckpointRevision: 0,
          messages: [],
          persistedMessageUids: [],
          summarizedMessageUids: ["answer"],
          retainedMessageUids: [],
        },
      ],
    }),
  );
  const collectionReads = t.mock.method(PartitionTransactions.prototype, "readKeysByCollection");
  const before = await read(journal, sessionId, async (reader) => {
    const display = await reader.readDisplayProjection();
    assert.equal(display.stats.messageCount, 2);
    const exportOnlyCollections = ["commands", "dialogs", "checkpointHeads"];
    const enumeratedCollections = () =>
      new Set(collectionReads.mock.calls.flatMap(({ arguments: [, names] }) => names));
    const displayCollections = enumeratedCollections();
    for (const name of exportOnlyCollections)
      assert.equal(displayCollections.has(name), false, name);
    collectionReads.mock.resetCalls();
    const value = await reader.exportSession();
    const exportCollections = enumeratedCollections();
    for (const name of exportOnlyCollections) assert.equal(exportCollections.has(name), true, name);
    assert.deepEqual(
      value.turnLifecycle.turns[scope.turnScopeId],
      await reader.readTurnState(scope.turnScopeId),
    );
    assert.deepEqual(value.turnLifecycle.commandReceipts, [
      result.result.turnTransition.commandReceipt,
    ]);
    assert.deepEqual(value.turnTimings, [{ ...scope, thinkingFinishedAt: committedAt }]);
    assert.deepEqual(
      value.turnSummaryCheckpoints[scope.turnScopeId],
      await reader.readCheckpointState(scope.turnScopeId),
    );
    return value;
  });
  assert.deepEqual(await exported(await reopen(t, journal, root, sessionId), sessionId), before);
});

test("export excludes retired artifact authority and associated facts without changing an older snapshot", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [message(sessionId, "m1")],
      timings: [{ ...scope, thinkingFinishedAt: committedAt }],
      summaryCheckpoints: [
        {
          ...scope,
          sessionId,
          userId: "admin",
          checkpointId: "summary",
          expectedCheckpointRevision: 0,
          messages: [],
          persistedMessageUids: [],
          summarizedMessageUids: ["m1"],
          retainedMessageUids: [],
        },
      ],
    }),
  );
  const envelope = createPluginArtifactEnvelope({
    pluginId: "export",
    artifactType: "result",
    artifactId: "artifact",
    sessionId,
    turnScopeId: scope.turnScopeId,
    sequence: 1,
    revision: 1,
    operation: "created",
    baseRevision: null,
    data: { title: "result" },
    occurredAt: committedAt,
  });
  await repository.commit(
    await prepare(journal, repository, "artifact", {
      artifactEvents: [
        {
          eventId: envelope.identity.eventId,
          envelope: { ...envelope, ordering: { ...envelope.ordering, aggregateVersion: 1 } },
          committedAt,
          deliveries: {},
        },
      ],
    }),
  );
  await read(journal, sessionId, async (reader) => {
    const before = await reader.exportSession();
    assert.equal(before.sessionArtifactEvents.length, 1);
    await repository.commit(
      await prepare(journal, repository, "delete", {
        messageDeletion: { commandId: "delete", anchor: { turnScopeId: scope.turnScopeId } },
      }),
    );
    assert.deepEqual(await reader.exportSession(), before);
  });
  const current = await exported(journal, sessionId);
  assert.deepEqual(current.messages, []);
  assert.deepEqual(current.sessionArtifactEvents, []);
  assert.deepEqual(current.turnTimings, []);
  assert.equal(Object.hasOwn(current, "turnSummaryCheckpoints"), false);
  assert.deepEqual(await exported(await reopen(t, journal, root, sessionId), sessionId), current);
});

test("collection enumeration shares one cold directory traversal across collections", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t, {
    partitionRecords: 2,
    pageRecords: 1,
  });
  const collections = ["commands", "events", "timings"];
  const transactions = new PartitionTransactions(journal);
  for (const key of ["b", "a", "c", "d", "e", "f"]) {
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId: `enumerate-${key}`,
      input: null,
      mutations: collections.map((collection) => ({ collection, key, owner: null, value: key })),
      result: null,
    });
  }
  await journal.close();
  async function measure(select) {
    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      return await cold.usingSnapshot((snapshot) => {
        const reader = new PartitionTransactions(cold);
        return observeDirectoryPageReads(() =>
          select((names) => reader.readKeysByCollection(snapshot, names)),
        );
      });
    } finally {
      await cold.close();
    }
  }
  const separate = await measure(async (read) => {
    const orderedKeys = [];
    for (const collection of collections)
      orderedKeys.push([...(await read([collection])).get(collection)]);
    return orderedKeys;
  });
  const grouped = await measure(async (read) =>
    [...(await read(collections)).values()].map((keys) => [...keys]),
  );
  assert.deepEqual(grouped.result, separate.result);
  for (const keys of grouped.result)
    assert.deepEqual(new Set(keys), new Set(["a", "b", "c", "d", "e", "f"]));
  const bytes = ({ reads }) => reads.reduce((total, read) => total + read[2], 0);
  assert.ok(bytes(grouped) > 0);
  assert.equal(bytes(grouped), bytes(separate));
  assert.equal(grouped.reads.length, separate.reads.length);
  t.diagnostic(
    `Cold directory pages: ${bytes(separate)} B separately, ${bytes(grouped)} B grouped`,
  );
});

test("collection enumeration chooses latest values and explicit removals across partitions", async (t) => {
  const { journal } = await createMessageCase(t, { partitionRecords: 2 });
  const transactions = new PartitionTransactions(journal);
  const publish = async (operationId, mutations) =>
    commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId,
      input: null,
      mutations,
      result: null,
    });
  await publish("create", [
    { collection: "pluginArtifacts", key: "key", owner: null, value: { revision: 1 } },
  ]);
  await journal.usingSnapshot(async (snapshot) => {
    const collections = ["pluginArtifacts", "events"];
    const original = await transactions.readKeysByCollection(snapshot, collections);
    assert.deepEqual(
      original,
      new Map([
        ["pluginArtifacts", new Set(["key"])],
        ["events", new Set()],
      ]),
    );
    const owner = (
      await transactions.lookupLatestMany({
        snapshot,
        collection: "pluginArtifacts",
        keys: ["key"],
      })
    ).get("key").owner;
    await publish("update", [
      { collection: "pluginArtifacts", key: "key", owner, value: { revision: 2 } },
    ]);
    await journal.usingSnapshot(async (latest) => {
      assert.deepEqual(await transactions.readKeysByCollection(latest, collections), original);
      assert.deepEqual(
        (
          await transactions.getLatestMany({
            snapshot: latest,
            collection: "pluginArtifacts",
            keys: ["key"],
          })
        ).get("key").value,
        { revision: 2 },
      );
    });
    await publish("remove", [{ collection: "pluginArtifacts", key: "key", owner, remove: true }]);
    assert.deepEqual(await transactions.readKeysByCollection(snapshot, collections), original);
    assert.deepEqual(
      (
        await transactions.getLatestMany({ snapshot, collection: "pluginArtifacts", keys: ["key"] })
      ).get("key").value,
      { revision: 1 },
    );
  });
  await journal.usingSnapshot(async (snapshot) => {
    assert.deepEqual(
      await transactions.readKeysByCollection(snapshot, ["pluginArtifacts"]),
      new Map([["pluginArtifacts", new Set(["key"])]]),
    );
    assert.equal(
      (
        await transactions.getLatestMany({ snapshot, collection: "pluginArtifacts", keys: ["key"] })
      ).get("key").remove,
      true,
    );
  });
});

test("export resolves replacement references into canonical tombstones after cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const natural = {
    ...scope,
    sessionId,
    messageUid: "user",
    userMessageId: "user",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: "original",
    attachments: [],
    ts: committedAt,
  };
  await repository.commit(
    await prepare(journal, repository, "seed", {
      messages: [natural, message(sessionId, "answer")],
    }),
  );
  const replaced = await repository.commit(
    await prepare(journal, repository, "replace", {
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
          messageUid: "replacement-user",
          userMessageId: "replacement-user",
        },
      },
    }),
  );
  const current = await exported(journal, sessionId);
  const tombstone = current.turnLifecycle.replacedTurns[scope.turnScopeId];
  assert.equal(tombstone.turnScopeId, scope.turnScopeId);
  assert.equal(tombstone.commandId, "replace");
  assert.equal(tombstone.replacementTurnScopeId, "replacement-turn");
  assert.deepEqual(
    tombstone.replacedTurnScopeIds,
    replaced.result.turnReplacement.receipt.result.turnReplacement.replacedTurnScopeIds,
  );
  assert.deepEqual(
    current.messages.map(({ messageUid }) => messageUid),
    ["replacement-user"],
  );
  assert.deepEqual(await exported(await reopen(t, journal, root, sessionId), sessionId), current);
});

test("cold collection enumeration skips unrelated directory leaves", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t, { pageBytes: 4096 });
  const transactions = new PartitionTransactions(journal);
  for (let i = 0; i < 96; i += 1) {
    const collection = i === 0 || i === 95 ? "timings" : "messages";
    const sequence = journal.head.sequence + 1;
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: sequence - 1,
      sequence,
      operationId: `enumeration-${i}`,
      input: null,
      mutations: [{ collection, key: `key-${i}`, owner: null, value: i }],
      result: null,
    });
  }
  await journal.close();
  async function measure(collections) {
    const cold = await PartitionJournal.open({ root, sessionId });
    try {
      return await cold.usingSnapshot((snapshot) =>
        observeDirectoryPageReads(() =>
          new PartitionTransactions(cold).readKeysByCollection(snapshot, collections),
        ),
      );
    } finally {
      await cold.close();
    }
  }
  const timings = await measure(["timings"]);
  const full = await measure(["messages", "timings"]);
  assert.deepEqual(timings.result.get("timings"), new Set(["key-0", "key-95"]));
  assert.deepEqual(timings.result.get("timings"), full.result.get("timings"));
  assert.equal(full.result.get("messages").size, 94);
  const bytes = ({ reads }) => reads.reduce((total, read) => total + read[2], 0);
  t.diagnostic(`Cold directory reads: ${bytes(timings)} B selected, ${bytes(full)} B combined`);
  assert.ok(bytes(timings) > 0 && bytes(timings) < bytes(full));
});

test("export rejects corrupt stored command facts instead of omitting them", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  await commitFixtureTransaction(new PartitionTransactions(journal), {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: "corrupt",
    input: null,
    mutations: [
      {
        collection: "commands",
        key: "corrupt",
        owner: null,
        value: { commandId: "corrupt", type: "unknown" },
      },
    ],
    result: null,
  });
  await assert.rejects(exported(journal, sessionId), { code: "SESSION_STORAGE_CORRUPT" });
});
