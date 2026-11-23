/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { readPartitionCommittedOutboxPage } from "../../src/session/partition-storage/partition-outbox.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { withPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { importImmutableSessionBusinessState } from "../../src/workspace-lifecycle/import-immutable-session-business-state.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { verifyImmutableSessionOutbox } from "../../src/workspace-lifecycle/verify-immutable-session-outbox.js";
import { commitImmutableSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { createTransactionCase } from "../helpers/partition-journal-cases.js";
import { migratedWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import { sessionId, scope } from "./immutable-session-migration-cases.js";
import { committedAt } from "./partition-session-messages.test-helpers.js";

test("cold outbox reconciliation obeys both record and byte budgets", async (t) => {
  const { sessionDir, store } = await migratedWorkspace(t);
  const budget = 8192;
  const { journal, root } = await createTransactionCase(
    t,
    { transactionBytes: budget, pageBytes: budget },
    { sessionId },
  );
  const ids = [];
  for (let index = 0; index < 3; index++) {
    const head = await store.snapshot();
    const { aggregateVersion } = await store.get(head, "metadata", "session");
    const created = createPluginArtifactEnvelope({
      pluginId: "workflow",
      artifactType: "result",
      artifactId: `large-${index}`,
      sessionId,
      turnScopeId: "t0",
      data: { text: "x".repeat(3000) },
      operation: "created",
      baseRevision: null,
      revision: 1,
      sequence: 1,
      occurredAt: committedAt,
    });
    const envelope = {
      ...created,
      ordering: { ...created.ordering, aggregateVersion: aggregateVersion + 1 },
    };
    const eventId = envelope.identity.eventId;
    await commitImmutableSessionChanges(store, {
      operationId: `large-event-${index}`,
      expectedGeneration: head.generation,
      committedAt,
      changes: { artifactEvents: [{ eventId, envelope, committedAt, deliveries: {} }] },
    });
    ids.push(eventId);
  }
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await importImmutableSessionBusinessState({ source, journal, limit: 1, maxBytes: 4096 });
      await journal.close();
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      await withPartitionSessionReader({ journal: reopened, ...scope }, async (reader) => {
        const detail = await reader.readDisplayProjection();
        assert.deepEqual(
          detail.sessionArtifactEvents.map(({ identity }) => identity.eventId),
          ids,
        );
        const exported = await reader.exportSession();
        assert.deepEqual(exported.sessionArtifactEvents, detail.sessionArtifactEvents);
      });
      const transactions = new PartitionSessionTransactions(reopened, scope);
      await reopened.usingSnapshot(async (snapshot) => {
        assert.equal(snapshot.limits.pageBytes, budget);
        assert.ok(ids.length <= snapshot.limits.pageRecords);
        const readPage = async (after) => {
          const before = reopened.work.readBytes;
          const page = await transactions.read(snapshot, (read) =>
            readPartitionCommittedOutboxPage(read, scope, snapshot, {
              after,
              limit: ids.length,
              tail: ids.length,
            }),
          );
          assert.ok(reopened.work.readBytes - before <= budget);
          return page;
        };
        const first = await readPage(0);
        assert.ok(first.cursor > 0 && first.cursor < ids.length);
        const second = await readPage(first.cursor);
        assert.equal(second.cursor, ids.length);
        assert.deepEqual(
          [...first.records, ...second.records].map(({ eventId }) => eventId),
          ids,
        );
        assert.deepEqual(await readPage(ids.length), { records: [], cursor: ids.length });
        await verifyImmutableSessionOutbox({ source, journal: reopened, scope, snapshot });
      });
    },
  );
});
