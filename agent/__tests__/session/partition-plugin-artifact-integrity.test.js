/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPluginArtifactEnvelope,
  pluginArtifactKey,
} from "@noobot/event-protocol/plugin-artifact-event";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

const identity = { pluginId: "workflow", artifactType: "result", artifactId: "integrity-result" };
function artifact(sessionId, aggregateVersion, revision = 1) {
  const source = createPluginArtifactEnvelope({
    ...identity,
    sessionId,
    turnScopeId: scope.turnScopeId,
    operation: revision === 1 ? "created" : "replaced",
    baseRevision: revision === 1 ? null : revision - 1,
    revision,
    sequence: revision,
    occurredAt: committedAt,
    data: { text: "result" },
  });
  const envelope = { ...source, ordering: { ...source.ordering, aggregateVersion } };
  return { eventId: envelope.identity.eventId, envelope, committedAt, deliveries: {} };
}

for (const [label, alter] of [
  [
    "forged data",
    (value) => {
      value.data = { text: "forged" };
    },
  ],
  [
    "forged revision",
    (value) => {
      value.revision = 2;
      value.operation = "replaced";
    },
  ],
  [
    "missing event",
    (value) => {
      value.eventId = "evt_missing";
    },
  ],
]) {
  test(`partition artifact read and replacement reject ${label} atomically`, async (t) => {
    const context = await createMessageCase(
      t,
      { transactionBytes: 16 * 1024 },
      { autoClose: false },
    );
    const { journal, sessionId } = context;
    const messages = openTestMessages(journal, sessionId);
    await messages.commit(
      await prepare(journal, messages, "seed", { messages: [message(sessionId, "m1")] }),
    );
    const metadata = await journal.usingSnapshot((snapshot) => messages.readMetadata({ snapshot }));
    await messages.commit(
      await prepare(journal, messages, "artifact", {
        artifactEvents: [artifact(sessionId, metadata.aggregateVersion + 1)],
      }),
    );
    const options = { journal, sessionId, parentSessionId: "" };
    await using old = await openPartitionSessionReader(options);
    const original = await old.readPluginArtifact(identity);
    const transactions = new PartitionTransactions(journal);
    const key = pluginArtifactKey(identity);
    const mutation = await journal.usingSnapshot((snapshot) =>
      transactions.withCollectionReader(snapshot, async (read) => {
        const stored = (
          await read({ collection: "pluginArtifacts", keys: [key], includeOwner: true })
        ).get(key);
        const value = structuredClone(stored.mutation.value);
        alter(value);
        return { collection: "pluginArtifacts", key, owner: stored.owner, value };
      }),
    );
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId: "corrupt",
      input: null,
      mutations: [mutation],
      result: null,
    });
    await using reader = await openPartitionSessionReader(options);
    const before = journal.head;
    await assert.rejects(reader.readPluginArtifact(identity), { code: "SESSION_STORAGE_CORRUPT" });
    const current = await reader.readMetadata();
    const request = await reader.prepareRequest({
      operationId: "replacement",
      committedAt,
      changes: {
        sessionMetadata: { customTitle: "must-not-publish" },
        artifactEvents: [artifact(sessionId, current.aggregateVersion + 1, 2)],
      },
    });
    await assert.rejects(messages.commit(request), { code: "SESSION_STORAGE_CORRUPT" });
    assert.equal(journal.head, before);
    assert.deepEqual(await old.readPluginArtifact(identity), original);
    await reader.close();
    await old.close();
    await assert.rejects(journal.close(), { code: "SESSION_STORAGE_CORRUPT" });
  });
}
