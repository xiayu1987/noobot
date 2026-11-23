/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { authorityOutboxSequenceKey } from "@noobot/event-protocol/outbox";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const identity = { pluginId: "workflow", artifactType: "result", artifactId: "sequence-result" };
const readerOptions = ({ journal, sessionId }) => ({ journal, sessionId, parentSessionId: "" });

async function seed(context) {
  const { journal, sessionId } = context;
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "seed", { messages: [message(sessionId, "m1")] }),
  );
  return messages;
}

async function publishArtifact(context, messages) {
  const { journal, sessionId } = context;
  const metadata = await journal.usingSnapshot((snapshot) => messages.readMetadata({ snapshot }));
  const source = createPluginArtifactEnvelope({
    ...identity,
    sessionId,
    turnScopeId: scope.turnScopeId,
    operation: "created",
    baseRevision: null,
    revision: 1,
    sequence: 1,
    occurredAt: committedAt,
    data: { text: "result" },
  });
  const envelope = {
    ...source,
    ordering: { ...source.ordering, aggregateVersion: metadata.aggregateVersion + 1 },
  };
  await messages.commit(
    await prepare(journal, messages, "artifact", {
      artifactEvents: [
        { eventId: envelope.identity.eventId, envelope, committedAt, deliveries: {} },
      ],
    }),
  );
  return envelope;
}

test("event sequence reads retain their generation and survive retirement and cold reopen", async (t) => {
  const context = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const { journal, sessionId, root } = context;
  const messages = await seed(context);
  let ordering;
  {
    await using before = await openPartitionSessionReader(readerOptions(context));
    ordering = (await publishArtifact(context, messages)).ordering;
    assert.equal(await before.readEventSequence(ordering.domain, ordering.scopeId), null);
    await using current = await openPartitionSessionReader(readerOptions(context));
    assert.equal(await current.readEventSequence(ordering.domain, ordering.scopeId), 1);
    assert.equal(await current.readEventSequence(ordering.domain, "unknown"), null);
    await messages.commit(
      await prepare(journal, messages, "delete", {
        messageDeletion: { commandId: "delete", anchor: { turnScopeId: scope.turnScopeId } },
      }),
    );
    await using retired = await openPartitionSessionReader(readerOptions(context));
    assert.equal(await retired.readPluginArtifact(identity), null);
    assert.equal(await retired.readEventSequence(ordering.domain, ordering.scopeId), 1);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reader = await openPartitionSessionReader({
    journal: cold,
    sessionId,
    parentSessionId: "",
  });
  assert.equal(await reader.readEventSequence(ordering.domain, ordering.scopeId), 1);
  await assert.rejects(reader.readEventSequence("", ordering.scopeId), TypeError);
  await reader.close();
  await assert.rejects(reader.readEventSequence(ordering.domain, ordering.scopeId), {
    code: "SESSION_READER_CLOSED",
  });
});

test("session event sequence reads use the lifecycle authority without publishing a duplicate floor", async (t) => {
  const context = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const { journal, sessionId } = context;
  const messages = openTestMessages(journal, sessionId);
  await using before = await openPartitionSessionReader(readerOptions(context));
  assert.equal(await before.readEventSequence("session", sessionId), 0);
  await messages.commit(
    await prepare(journal, messages, "accept", {
      turnTransition: {
        ...scope,
        sessionId,
        commandId: "accept",
        causationId: "accept",
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: "presentation",
        executionId: "agent:turn-1",
        executionKind: "agent",
        rootExecutionId: "agent:turn-1",
      },
    }),
  );
  assert.equal(await before.readEventSequence("session", sessionId), 0);
  await using current = await openPartitionSessionReader(readerOptions(context));
  assert.equal(
    await current.readEventSequence("session", sessionId),
    (await current.readLifecycleHead()).sequence,
  );
  assert.equal(await current.readEventSequence("session", "foreign"), null);
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const key = authorityOutboxSequenceKey("session", sessionId);
    assert.equal(
      (
        await transactions.getLatestMany({ snapshot, collection: "eventSequences", keys: [key] })
      ).get(key),
      null,
    );
  });
});

for (const value of [-1, 1.5, "1", {}, null, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid stored sequence floor rejects both reads and writes: ${JSON.stringify(value)}`, async (t) => {
    const context = await createMessageCase(
      t,
      { transactionBytes: 16 * 1024 },
      { autoClose: false },
    );
    const { journal } = context;
    const messages = await seed(context);
    const envelope = await publishArtifact(context, messages);
    const { domain, scopeId } = envelope.ordering;
    const key = authorityOutboxSequenceKey(domain, scopeId);
    const transactions = new PartitionTransactions(journal);
    const mutation = await journal.usingSnapshot((snapshot) =>
      transactions.withCollectionReader(snapshot, async (read) => {
        const stored = (
          await read({ collection: "eventSequences", keys: [key], includeOwner: true })
        ).get(key);
        return { collection: "eventSequences", key, owner: stored.owner, value };
      }),
    );
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId: "corrupt-floor",
      input: null,
      mutations: [mutation],
      result: null,
    });
    await using reader = await openPartitionSessionReader(readerOptions(context));
    const head = journal.head;
    await assert.rejects(reader.readEventSequence(domain, scopeId), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    const metadata = await reader.readMetadata();
    const source = createPluginArtifactEnvelope({
      ...identity,
      sessionId: context.sessionId,
      turnScopeId: scope.turnScopeId,
      operation: "replaced",
      baseRevision: 1,
      revision: 2,
      sequence: 2,
      occurredAt: committedAt,
      data: {},
    });
    const next = {
      ...source,
      ordering: { ...source.ordering, aggregateVersion: metadata.aggregateVersion + 1 },
    };
    const request = await reader.prepareRequest({
      operationId: "must-not-publish",
      committedAt,
      changes: {
        artifactEvents: [
          { eventId: next.identity.eventId, envelope: next, committedAt, deliveries: {} },
        ],
      },
    });
    await assert.rejects(messages.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
    assert.equal(journal.head, head);
    await reader.close();
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  });
}
