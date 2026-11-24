/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import { createMessageCase } from "./partition-session-messages.test-helpers.js";

const corruptMetadata = [
  ...[
    "messages",
    "dialogOrder",
    "turnTimings",
    "sessionArtifactEvents",
    "turnLifecycle",
    "turnSummaryCheckpoints",
  ].map((field) => [
    `collection fact ${field}`,
    (metadata) => ({ ...metadata, [field]: null }),
    new RegExp(`collection fact:${field}`),
  ]),
  ...[
    "version",
    "revision",
    "sessionArtifacts",
    "turnTerminalCommits",
    "shortMemoryCheckpoint",
  ].map((field) => [
    `retired ${field}`,
    (metadata) => ({ ...metadata, [field]: null }),
    new RegExp(`retired_session_field:${field}`),
  ]),
  ...[
    ["turnStatuses", /duplicate_terminal_fact/],
    ["mutationReceipts", /duplicate_command_receipts/],
  ].map(([field, message]) => [
    `duplicate ${field}`,
    (metadata) => ({ ...metadata, [field]: [] }),
    message,
  ]),
  ...["stale title", "", null].map((autoTitle) => [
    `autoTitle=${JSON.stringify(autoTitle)}`,
    (metadata) => ({ ...metadata, autoTitle }),
    /derived autoTitle/,
  ]),
  ["numeric model alias", (metadata) => ({ ...metadata, modelAlias: 42 }), /modelAlias/],
  ["missing model alias", ({ modelAlias: _alias, ...metadata }) => metadata, /modelAlias/],
  ["blank custom title", (metadata) => ({ ...metadata, customTitle: " " }), /customTitle/],
  ["null custom title", (metadata) => ({ ...metadata, customTitle: null }), /customTitle/],
  [
    "non-array connectors",
    (metadata) => ({ ...metadata, selectedConnectorIds: {} }),
    /selectedConnectorIds/,
  ],
  [
    "duplicate connectors",
    (metadata) => ({ ...metadata, selectedConnectorIds: ["one", "one"] }),
    /selectedConnectorIds/,
  ],
  [
    "noncanonical connectors",
    (metadata) => ({ ...metadata, selectedConnectorIds: [" one "] }),
    /selectedConnectorIds/,
  ],
  [
    "missing connectors",
    ({ selectedConnectorIds: _ids, ...metadata }) => metadata,
    /selectedConnectorIds/,
  ],
];

for (const [label, invalidate, message] of corruptMetadata) {
  test(`stored ${label} rejects reads, commits and initialization replay`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t);
    const scope = { sessionId, parentSessionId: "" };
    const transactions = new PartitionTransactions(journal);
    const sessions = new PartitionSessionTransactions(journal, scope);
    const retained = await journal.snapshot();
    const metadata = await sessions.readMetadata(retained);
    const { collection, key } = PARTITION_SESSION_METADATA;
    const entries = await transactions.lookupLatestMany({
      snapshot: retained,
      collection,
      keys: [key],
    });
    const generation = journal.head.sequence;
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      sequence: generation + 1,
      expectedGeneration: generation,
      operationId: "inject-invalid-metadata",
      input: null,
      mutations: [{ collection, key, owner: entries.get(key).owner, value: invalidate(metadata) }],
      result: null,
    });
    assert.deepEqual(await sessions.readMetadata(retained), metadata);
    await journal.releaseSnapshot(retained);
    await journal.close();
    const cold = await PartitionJournal.open({ root, sessionId });
    const reader = new PartitionSessionTransactions(cold, scope);
    const head = structuredClone(cold.head);
    const corrupt = { code: "SESSION_STORAGE_CORRUPT", message };
    let released = 0;
    const access = createPartitionSessionReaderAccess({
      withJournalRemoval: () => assert.fail("Unexpected journal removal"),
      acquireJournal: async () => ({
        journal: cold,
        async [Symbol.asyncDispose]() {
          released += 1;
        },
      }),
    });
    await assert.rejects(access.readPlacement({ ...scope, sessionDir: root }), corrupt);
    assert.equal(released, 1);
    await assert.rejects(openPartitionSessionReader({ journal: cold, ...scope }), corrupt);
    await cold.usingSnapshot(async (snapshot) => {
      await assert.rejects(reader.readMetadata(snapshot), corrupt);
      await assert.rejects(
        reader.read(snapshot, () => assert.fail("Must not read corrupt metadata")),
        corrupt,
      );
    });
    const request = {
      epoch: cold.head.epoch,
      expectedGeneration: cold.head.sequence,
      operationId: "must-not-commit",
      input: null,
    };
    await assert.rejects(
      reader.commit(request, () => assert.fail("Must not prepare")),
      corrupt,
    );
    assert.deepEqual(cold.head, head);
    assert.equal(cold.work.writeBytes, 0);
    await assert.rejects(cold.close(), corrupt);
    const reopened = await PartitionJournal.open({ root, sessionId });
    const initializing = new PartitionSessionTransactions(reopened, scope);
    await assert.rejects(
      initializing.initialize(request, () => assert.fail("Must not initialize")),
      corrupt,
    );
    assert.deepEqual(reopened.head, head);
    assert.equal(reopened.work.writeBytes, 0);
    await assert.rejects(reopened.close(), corrupt);
  });
}
