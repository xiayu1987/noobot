/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol/outbox";
import {
  artifactRetirementKey,
  createPluginArtifactEnvelope,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
  PARTITION_SESSION_ARTIFACT_EVENTS,
} from "@noobot/session-protocol/partition-collections";
import {
  readPartitionCommittedOutboxPage,
  readPartitionIndexedArtifactEvent,
  readPartitionOutboxCursor,
  readPartitionOutboxEvent,
  readPartitionOutboxPage,
  readPartitionSessionArtifactEventWindow,
} from "../../src/session/partition-storage/partition-outbox.js";
import { readPartitionPluginArtifact } from "../../src/session/partition-storage/partition-artifact-events.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { importImmutableSessionBusinessState } from "../../src/workspace-lifecycle/import-immutable-session-business-state.js";
import { commitImmutableSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { verifyImmutableSessionOutbox } from "../../src/workspace-lifecycle/verify-immutable-session-outbox.js";
import { verifyImmutableSessionArtifacts } from "../../src/workspace-lifecycle/verify-immutable-session-artifacts.js";
import { migratedWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import {
  createMessageCase,
  committedAt,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";
import { sessionId, scope, message } from "./immutable-session-migration-cases.js";

const retiredCursors = { source: true, target: true };

for (const [label, seedSource, targetAction, mismatch, cursors, gap, artifactIndex, retirement] of [
  ["matching", true, "keep", null],
  ["missing artifact membership", true, "keep", null, null, null, "missing"],
  ["invalid artifact membership", true, "keep", null, null, null, "invalid"],
  ["missing", true, null, /outbox event differs from source/],
  ["extra", false, "keep", /outbox tail differs from source/],
  ["different deliveries", true, "acknowledge", /outbox event differs from source/],
  ["different positions", true, "offset", /outbox event position differs from source/],
  ["extra invisible tail", false, "retire", /outbox tail differs from source/],
  ["matching retired positions", "retire", "retire", null, retiredCursors],
  ["missing retirement", "retire", "retire", null, retiredCursors, null, null, "missing"],
  ["extra retirement", "retire", "retire", null, retiredCursors, null, null, "extra"],
  [
    "different retirement cutoff",
    "retire",
    "retire",
    null,
    retiredCursors,
    null,
    null,
    "different",
  ],
  [
    "staged cutoff beyond tail",
    "retire",
    "retire",
    null,
    retiredCursors,
    null,
    null,
    "staged-tail",
  ],
  [
    "matching cutoffs beyond tail",
    "retire",
    "retire",
    null,
    retiredCursors,
    null,
    null,
    "both-tails",
  ],
  [
    "missing source position after retirement",
    "retire",
    "retire",
    /missing or invalid position/,
    null,
    "source",
  ],
  [
    "missing target position after retirement",
    "retire",
    "retire",
    /Missing partition event position/,
    null,
    "target",
  ],
  ["extra source position", true, "keep", /Source event position is outside/, null, "source-extra"],
  ["extra staged position", true, "keep", /Staged event position is outside/, null, "target-extra"],
  ["compacted source and visible target", "compact", "acknowledge", /extra outbox event/],
  ["matching delivery compaction", "compact", "compact", null],
  ["matching cursors", true, "acknowledge", null, { source: true, target: true }],
  [
    "missing cursor",
    true,
    "acknowledge",
    /outbox cursor differs from source/,
    { source: true, target: false },
  ],
  ["extra cursor", true, "acknowledge", /extra outbox cursor/, { source: false, target: true }],
]) {
  test(`outbox reconciliation checks persisted ${label}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, { partitionRecords: 1 }, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    const commitTarget = async (operationId, changes) => {
      const result = await repository.commit(
        await prepare(journal, repository, operationId, changes),
      );
      assert.equal(result.status, "committed");
      return result.result;
    };
    await commitTarget("seed-turn", { messages: [message(0), message(1), message(2)] });
    const { aggregateVersion } = await journal.usingSnapshot((snapshot) =>
      repository.readMetadata({ snapshot }),
    );
    const makeEnvelope = (artifactId) =>
      createPluginArtifactEnvelope({
        pluginId: "workflow",
        artifactType: "result",
        artifactId,
        sessionId,
        turnScopeId: "t0",
        data: { text: "migration test" },
        operation: "created",
        baseRevision: null,
        revision: 1,
        sequence: 1,
        occurredAt: committedAt,
      });
    if (targetAction === "offset") {
      const before = await store.snapshot();
      const beforeTail = await store.get(before, "metadata", "events");
      const deletion = await commitImmutableSessionChanges(store, {
        operationId: "align-source-version",
        expectedGeneration: before.generation,
        committedAt,
        changes: {
          messageDeletion: { commandId: "align-source-version", anchor: { turnScopeId: "t2" } },
        },
      });
      const after = await store.snapshot();
      assert.equal(deletion.result.messageDeletion.receipt.aggregateVersion, aggregateVersion + 1);
      assert.equal(
        (await store.get(after, "metadata", "session")).aggregateVersion,
        aggregateVersion + 1,
      );
      assert.deepEqual(await store.get(after, "metadata", "events"), beforeTail);
      const prefix = makeEnvelope("prefix-artifact");
      const result = await commitTarget("seed-prefix", {
        artifactEvents: [
          {
            eventId: prefix.identity.eventId,
            envelope: {
              ...prefix,
              ordering: { ...prefix.ordering, aggregateVersion: aggregateVersion + 1 },
            },
            committedAt,
            deliveries: {},
          },
        ],
      });
      assert.equal(result.events[0].identity.eventId, prefix.identity.eventId);
    }
    const envelope = makeEnvelope("migration-test-artifact");
    const eventId = envelope.identity.eventId;
    const event = {
      eventId,
      envelope: {
        ...envelope,
        ordering: {
          ...envelope.ordering,
          aggregateVersion: aggregateVersion + (targetAction === "offset" ? 2 : 1),
        },
      },
      committedAt,
      deliveries: {},
    };
    const consumerId = "migration-test-consumer";
    const acknowledge = (advance) => ({
      deliveries: [
        {
          type: "acknowledge",
          consumerId,
          eventId,
          orderingDomain: envelope.ordering.domain,
          orderingScopeId: envelope.ordering.scopeId,
          sequence: envelope.ordering.sequence,
          deliveredAt: committedAt,
        },
      ],
      outboxCursors: advance ? [{ consumerId, expectedCursor: 0, cursor: 1 }] : [],
    });
    const advanceCursor = { outboxCursors: [{ consumerId, expectedCursor: 0, cursor: 1 }] };
    const retire = {
      messageDeletion: { commandId: "retire-event-turn", anchor: { turnScopeId: "t0" } },
    };
    const commitSource = async (operationId, changes) =>
      commitImmutableSessionChanges(store, {
        operationId,
        expectedGeneration: (await store.snapshot()).generation,
        committedAt,
        changes,
      });
    const changes = { artifactEvents: [event] };
    const maintenance = {
      outboxMaintenance: { retainDeliveredAfter: "2027-01-01T00:00:00.000Z" },
    };
    if (seedSource) {
      const result = await commitSource("seed-event", changes);
      assert.equal(result.result.events[0].identity.eventId, eventId);
      if (seedSource === "retire") {
        await commitSource("retire-event-turn", retire);
        await commitSource("advance-after-retirement", advanceCursor);
      } else if (seedSource === "compact") {
        await commitSource("acknowledge-event", acknowledge(false));
        await commitSource("compact-delivery", maintenance);
        await commitSource("advance-after-compaction", advanceCursor);
      } else if (cursors) {
        await commitSource("acknowledge-event", acknowledge(cursors.source));
      }
    }
    if (targetAction) {
      const result = await commitTarget("seed-event", changes);
      assert.equal(result.events[0].identity.eventId, eventId);
      if (targetAction === "acknowledge") {
        await commitTarget("acknowledge-event", acknowledge(cursors?.target));
      } else if (targetAction === "compact") {
        await commitTarget("acknowledge-event", acknowledge(false));
        const { outboxMaintenance } = await commitTarget("compact-delivery", maintenance);
        assert.deepEqual(outboxMaintenance, {
          compacted: true,
          removed: 1,
          scanned: 1,
          hasMore: false,
          nextRetainedDeliveryAt: null,
        });
        await commitTarget("advance-after-compaction", advanceCursor);
      } else if (targetAction === "retire") {
        await commitTarget("retire-event-turn", retire);
        if (cursors?.target) await commitTarget("advance-after-retirement", advanceCursor);
      }
    }
    if (gap === "source" || gap === "source-extra") {
      await store.commit({
        expectedGeneration: (await store.snapshot()).generation,
        operationId: "change-source-position",
        changes: [
          gap === "source"
            ? { collection: "eventOrder", key: "0000000000000001", remove: true }
            : { collection: "eventOrder", key: "0000000000000002", value: eventId },
        ],
      });
    }
    if (retirement) {
      const cutoff = retirement === "staged-tail" || retirement === "both-tails" ? 2 : 0;
      const turnScopeId = retirement === "extra" ? "extra-turn" : cutoff === 2 ? "t0" : "t1";
      const key = artifactRetirementKey(turnScopeId);
      if (retirement === "both-tails") {
        await store.commit({
          expectedGeneration: (await store.snapshot()).generation,
          operationId: "change-source-retirement",
          changes: [{ collection: "metadata", key, value: cutoff }],
        });
      }
      const transactions = new PartitionTransactions(journal);
      await journal.usingSnapshot(async (snapshot) => {
        const collection = "metadata";
        const record = (
          await transactions.getLatestMany({ snapshot, collection, keys: [key] })
        ).get(key);
        if (retirement === "extra") assert.equal(record, null);
        else assert.equal(record.value, 1);
        const entry = (
          await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })
        ).get(key);
        const owner = entry === null ? null : entry.owner;
        const result = await commitFixtureTransaction(transactions, {
          epoch: snapshot.epoch,
          expectedGeneration: snapshot.sequence,
          sequence: snapshot.sequence + 1,
          operationId: "change-target-retirement",
          input: null,
          mutations: [
            retirement === "missing"
              ? { collection, key, owner, remove: true }
              : { collection, key, owner, value: cutoff },
          ],
          result: null,
        });
        assert.equal(result.status, "committed");
      });
    }
    if (gap === "target" || gap === "target-extra" || artifactIndex) {
      const transactions = new PartitionTransactions(journal);
      await journal.usingSnapshot(async (snapshot) => {
        const collection = artifactIndex ? PARTITION_SESSION_ARTIFACT_EVENTS : "eventOrder";
        const key = artifactIndex ? eventId : gap === "target-extra" ? "2" : "1";
        const entry = (
          await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })
        ).get(key);
        const owner = entry === null ? null : entry.owner;
        const { epoch, sequence } = snapshot;
        const result = await commitFixtureTransaction(transactions, {
          epoch,
          expectedGeneration: sequence,
          sequence: sequence + 1,
          operationId: "change-target-index",
          input: null,
          mutations: [
            gap === "target-extra"
              ? { collection, key, owner, value: eventId }
              : artifactIndex === "invalid"
                ? { collection, key, owner, value: false }
                : { collection, key, owner, remove: true },
          ],
          result: null,
        });
        assert.equal(result.status, "committed");
      });
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        const transactions = new PartitionSessionTransactions(reopened, scope);
        const verify = () =>
          reopened.usingSnapshot((snapshot) =>
            verifyImmutableSessionOutbox({ source, journal: reopened, scope, snapshot }),
          );
        if (gap) {
          await assert.rejects(verify, {
            code:
              gap === "target" ? "SESSION_STORAGE_CORRUPT" : "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: mismatch,
          });
          return;
        }
        const [expected, actual] = await Promise.all([
          source.readOutboxEvent(eventId),
          reopened.usingSnapshot((snapshot) =>
            transactions.read(snapshot, (read) =>
              readPartitionOutboxEvent(read, scope, snapshot, eventId),
            ),
          ),
        ]);
        assert.equal(expected?.eventId ?? null, seedSource === true ? eventId : null);
        const verifyArtifacts = () =>
          reopened.usingSnapshot((snapshot) =>
            verifyImmutableSessionArtifacts({ source, journal: reopened, scope, snapshot }),
          );
        if (artifactIndex === "missing") {
          await assert.rejects(verifyArtifacts, {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: `Staged session artifact event differs from source: ${eventId}`,
          });
        } else if (artifactIndex === "invalid") {
          await assert.rejects(verifyArtifacts, {
            code: "SESSION_STORAGE_CORRUPT",
            message: /Invalid partition session artifact index entry/,
          });
        } else if (retirement === "staged-tail" || retirement === "both-tails") {
          const side = retirement === "staged-tail" ? "Staged" : "Source";
          await assert.rejects(verifyArtifacts, {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: `${side} artifact retirement exceeds committed outbox tail: ${artifactRetirementKey("t0")}`,
          });
          if (retirement === "both-tails") {
            const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
            await assert.rejects(source.readPluginArtifact(envelope.payload), invalid);
            await assert.rejects(
              source.visitArtifactEvents(() => assert.fail("exported")),
              invalid,
            );
          }
          await reopened.usingSnapshot((snapshot) =>
            transactions.read(snapshot, async (read) => {
              const invalid = { code: "SESSION_STORAGE_CORRUPT" };
              await assert.rejects(
                readPartitionPluginArtifact(read, envelope.payload, { scope }),
                invalid,
              );
              await assert.rejects(
                readPartitionSessionArtifactEventWindow(read, scope, snapshot, {
                  ids: [eventId],
                  offset: 0,
                }),
                invalid,
              );
            }),
          );
        } else if (retirement) {
          const extra = retirement === "extra";
          const key = artifactRetirementKey(extra ? "extra-turn" : "t1");
          await assert.rejects(verifyArtifacts, {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: extra
              ? `Staged session has an extra artifact retirement: ${key}`
              : `Staged artifact retirement differs from source: ${key}`,
          });
        } else if (targetAction === "offset") {
          await assert.rejects(
            verifyArtifacts,
            /Staged artifact retirement differs from source: artifactRetirement:t2$/,
          );
        } else if (!seedSource && targetAction === "retire") {
          await assert.rejects(
            verifyArtifacts,
            /Staged session has an extra artifact retirement: artifactRetirement:t0$/,
          );
        } else if (seedSource && !targetAction) {
          await assert.rejects(verifyArtifacts, /Staged plugin artifact differs from source/);
        } else if (targetAction && !seedSource) {
          await assert.rejects(verifyArtifacts, /Staged session has an extra plugin artifact/);
        } else {
          await verifyArtifacts();
        }
        if (
          (seedSource === "compact" || seedSource === "retire") &&
          retirement !== "staged-tail" &&
          retirement !== "both-tails"
        ) {
          const sourceArtifact = await source.readPluginArtifact(envelope.payload);
          assert.equal(sourceArtifact?.eventId ?? null, seedSource === "retire" ? null : eventId);
          const exported = [];
          await source.visitArtifactEvents(({ envelope: entry }) => exported.push(entry));
          assert.deepEqual(exported, seedSource === "retire" ? [] : [event.envelope]);
          assert.equal(await source.readOutboxCursor(consumerId), 1);
          const { records } = await source.readMigrationOutboxPage({ after: 0, limit: 1 });
          assert.equal(records[0].committed.eventId, eventId);
          await reopened.usingSnapshot((snapshot) =>
            transactions.read(snapshot, async (read) => {
              const targetArtifact = await readPartitionPluginArtifact(read, envelope.payload, {
                snapshot,
                scope,
              });
              const window = await readPartitionSessionArtifactEventWindow(read, scope, snapshot, {
                ids: [eventId],
                offset: 0,
              });
              assert.deepEqual(targetArtifact, sourceArtifact);
              assert.equal(window.length, 1);
              const [event] = window;
              assert.deepEqual(event === null ? [] : [event.envelope], exported);
              const { records: committed, cursor } = await readPartitionCommittedOutboxPage(
                read,
                scope,
                snapshot,
                {
                  after: 0,
                  limit: 1,
                  tail: 1,
                },
              );
              assert.equal(cursor, 1);
              assert.equal(committed.length, 1);
              assert.equal(committed[0].eventId, eventId);
            }),
          );
        }
        assert.equal(
          actual?.eventId ?? null,
          targetAction && !["retire", "compact"].includes(targetAction) ? eventId : null,
        );
        if (targetAction === "offset") {
          assert.deepEqual(
            normalizeAuthorityEventOutbox([actual]),
            normalizeAuthorityEventOutbox([expected]),
          );
          assert.equal(actual.ordinal, expected.ordinal + 1);
        }
        if (cursors) {
          if (seedSource === "retire") assert.equal(actual, null);
          else {
            assert.deepEqual(
              normalizeAuthorityEventOutbox([actual]),
              normalizeAuthorityEventOutbox([expected]),
            );
            assert.equal(actual.ordinal, expected.ordinal);
          }
          assert.equal(await source.readOutboxCursor(consumerId), cursors.source ? 1 : null);
          const cursor = await reopened.usingSnapshot((snapshot) =>
            transactions.read(snapshot, (read) =>
              readPartitionOutboxCursor(read, scope, snapshot, consumerId),
            ),
          );
          assert.equal(cursor, cursors.target ? 1 : null);
        } else if (targetAction === "acknowledge" && expected !== null) {
          assert.deepEqual(actual.envelope, expected.envelope);
          assert.equal(actual.committedAt, expected.committedAt);
          assert.deepEqual(expected.deliveries, {});
          assert.equal(actual.deliveries[consumerId].deliveredAt, committedAt);
        }
        if (retirement === "both-tails")
          await assert.rejects(verify, {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: `Invalid source outbox retirement: ${artifactRetirementKey("t0")}`,
          });
        else if (mismatch)
          await assert.rejects(verify, {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: mismatch,
          });
        else await verify();
      },
    );
    assert.deepEqual(await readFile(current), before);
  });
}

test("empty staging distinguishes delivery compaction from turn retirement after cold reopen", async (t) => {
  const { sessionDir, store } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(
    t,
    { transactionBytes: 4096, batchBytes: 8192, queueBytes: 8192 },
    { sessionId },
  );
  const consumerId = "migration-consumer";
  const commitSource = async (operationId, changes) =>
    commitImmutableSessionChanges(store, {
      operationId,
      expectedGeneration: (await store.snapshot()).generation,
      committedAt,
      changes,
    });
  const events = [];
  for (const artifactId of ["compacted", "pending", "retired"]) {
    const head = await store.snapshot();
    const { aggregateVersion } = await store.get(head, "metadata", "session");
    const created = createPluginArtifactEnvelope({
      pluginId: "workflow",
      artifactType: "result",
      artifactId,
      sessionId,
      turnScopeId: artifactId === "retired" ? "t2" : "t0",
      data: { text: artifactId },
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
    const event = { eventId: envelope.identity.eventId, envelope, committedAt, deliveries: {} };
    assert.deepEqual(
      (await commitSource(`create-${artifactId}`, { artifactEvents: [event] })).result.events,
      [envelope],
    );
    events.push(event);
  }
  const [compacted, pending, retired] = events;
  const acknowledge = ({ eventId, envelope: { ordering } }) => ({
    type: "acknowledge",
    consumerId,
    eventId,
    orderingDomain: ordering.domain,
    orderingScopeId: ordering.scopeId,
    sequence: ordering.sequence,
    deliveredAt: committedAt,
  });
  await commitSource("acknowledge-first", { deliveries: [acknowledge(compacted)] });
  const maintenance = await commitSource("compact-first", {
    outboxMaintenance: { retainDeliveredAfter: "2027-01-01T00:00:00.000Z" },
  });
  assert.equal(maintenance.result.outboxMaintenance.removed, 1);
  await commitSource("retire-turn", {
    messageDeletion: { commandId: "retire-turn", anchor: { turnScopeId: "t2" } },
  });
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      assert.equal(await source.readMetadataEntry(artifactRetirementKey("t2")), 3);
      const firstPage = await source.readMigrationOutboxPage({ after: 0, limit: 2 });
      const lastPage = await source.readMigrationOutboxPage({ after: firstPage.cursor, limit: 2 });
      assert.deepEqual(
        [...firstPage.records, ...lastPage.records].map(({ committed, delivery, retired }) => [
          committed.eventId,
          delivery !== null,
          retired,
        ]),
        [
          [compacted.eventId, false, false],
          [pending.eventId, true, false],
          [retired.eventId, false, true],
        ],
      );
      assert.equal(lastPage.cursor, 3);
      const batches = new Map();
      const append = journal.appendTransaction.bind(journal);
      t.mock.method(journal, "appendTransaction", (identity, { validateScope, prepare }) =>
        append(identity, {
          validateScope,
          async prepare(snapshot, staged, generation) {
            const result = await prepare(snapshot, staged, generation);
            const event = result.mutations.find(({ collection }) => collection === "eventOrder");
            if (event) {
              if (!batches.has(snapshot.sequence)) batches.set(snapshot.sequence, []);
              batches.get(snapshot.sequence).push(event.value);
            }
            return result;
          },
        }),
      );
      await importImmutableSessionBusinessState({ source, journal, limit: 1, maxBytes: 4096 });
      assert.deepEqual(
        [...batches.values()],
        [[compacted.eventId, pending.eventId], [retired.eventId]],
      );
      await journal.close();
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const transactions = new PartitionSessionTransactions(reopened, scope);
      const repository = openTestMessages(reopened, sessionId);
      const readCurrent = (run) =>
        reopened.usingSnapshot((snapshot) =>
          transactions.read(snapshot, (read) => run(read, snapshot)),
        );
      await reopened.usingSnapshot(async (snapshot) => {
        const options = { source, journal: reopened, scope, snapshot };
        await verifyImmutableSessionOutbox(options);
        await verifyImmutableSessionArtifacts(options);
      });
      await readCurrent(async (read, snapshot) => {
        const outbox = (selection) =>
          readPartitionOutboxPage(read, scope, snapshot, { consumerId, ...selection });
        const first = await outbox({ after: 0, limit: 1 });
        const second = await outbox({ after: first.cursor, limit: 1 });
        const third = await outbox({ after: second.cursor, limit: 1 });
        assert.deepEqual([first.events, first.cursor, first.hasMore], [[], 1, true]);
        assert.deepEqual(
          [second.events.map(({ eventId }) => eventId), second.cursor, second.hasMore],
          [[pending.eventId], 2, true],
        );
        assert.deepEqual([third.events, third.cursor, third.hasMore], [[], 3, false]);
        assert.equal(
          await readPartitionOutboxEvent(read, scope, snapshot, compacted.eventId),
          null,
        );
        assert.equal(
          (await readPartitionOutboxEvent(read, scope, snapshot, pending.eventId)).eventId,
          pending.eventId,
        );
        assert.equal(await readPartitionOutboxEvent(read, scope, snapshot, retired.eventId), null);
        const compactions = await read({
          collection: PARTITION_OUTBOX_DELIVERY_COMPACTIONS,
          keys: events.map(({ eventId }) => eventId),
        });
        assert.deepEqual(
          [...compactions.values()].map((entry) => (entry === null ? null : entry.value)),
          [true, null, null],
        );
        const ranges = await read({ collection: "turnOutbox", keys: ["t0", "t2"] });
        assert.deepEqual(
          [...ranges.values()].map((entry) => entry.value),
          [
            { turnScopeId: "t0", lastOrdinal: 2, removedThrough: 0, eventCount: 2 },
            { turnScopeId: "t2", lastOrdinal: 3, removedThrough: 3, eventCount: 0 },
          ],
        );
        const { records: committed, cursor } = await readPartitionCommittedOutboxPage(
          read,
          scope,
          snapshot,
          { after: 0, limit: 3, tail: 3 },
        );
        assert.equal(cursor, 3);
        const ids = events.map(({ eventId }) => eventId);
        assert.deepEqual(
          committed.map(({ eventId }) => eventId),
          ids,
        );
        for (const event of events) {
          const artifact = await readPartitionPluginArtifact(read, event.envelope.payload, {
            scope,
          });
          if (event === retired) assert.equal(artifact, null);
          else assert.equal(artifact.eventId, event.eventId);
        }
        assert.equal(
          await readPartitionIndexedArtifactEvent(read, scope, snapshot, retired.eventId),
          null,
        );
        const window = await readPartitionSessionArtifactEventWindow(read, scope, snapshot, {
          ids: [compacted.eventId, pending.eventId],
          offset: 0,
        });
        assert.deepEqual(
          window.map(({ envelope }) => envelope),
          [compacted.envelope, pending.envelope],
        );
      });
      const commitTarget = async (operationId, changes) =>
        repository.commit(await prepare(reopened, repository, operationId, changes));
      const cursor = (expectedCursor, next) => [{ consumerId, expectedCursor, cursor: next }];
      const before = reopened.head.sequence;
      await assert.rejects(
        commitTarget("ack-compacted", { deliveries: [acknowledge(compacted)] }),
        {
          code: "SESSION_OUTBOX_EVENT_MISSING",
        },
      );
      await assert.rejects(commitTarget("skip-pending", { outboxCursors: cursor(0, 2) }), {
        code: "SESSION_OUTBOX_CURSOR_UNDELIVERED",
      });
      assert.equal(reopened.head.sequence, before);
      assert.equal(
        (await commitTarget("cross-compacted", { outboxCursors: cursor(0, 1) })).status,
        "committed",
      );
      assert.equal(
        (
          await commitTarget("ack-pending", {
            deliveries: [acknowledge(pending)],
            outboxCursors: cursor(1, 2),
          })
        ).status,
        "committed",
      );
      assert.equal(
        await readCurrent((read, snapshot) =>
          readPartitionOutboxCursor(read, scope, snapshot, consumerId),
        ),
        2,
      );
    },
  );
});
