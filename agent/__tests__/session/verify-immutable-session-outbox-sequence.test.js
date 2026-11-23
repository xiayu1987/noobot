/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { authorityOutboxSequenceKey } from "@noobot/event-protocol/outbox";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { sessionLifecycleSequenceKey } from "@noobot/session-protocol/turn-lifecycle";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { commitImmutableSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { verifyImmutableSessionOutbox } from "../../src/workspace-lifecycle/verify-immutable-session-outbox.js";
import { migratedWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import {
  createMessageCase,
  committedAt,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";
import {
  sessionId,
  scope,
  message,
  lifecycleChanges,
} from "./immutable-session-migration-cases.js";

for (const [label, side, domain, value, expected] of [
  ["missing stored floor", "target", "artifact", null, /Staged event sequence floor differs/],
  ["different stored floor", "target", "artifact", 2, /Staged event sequence floor differs/],
  ["extra stored floor", "target", "extra", 1, /extra event sequence floor/],
  ["duplicate lifecycle floor", "target", "session", 1, /duplicates its head/],
  ["missing source lifecycle floor", "source", "session", null, /disagrees with committed events/],
  ["different source lifecycle floor", "source", "session", 2, /disagrees with committed events/],
  ["next lifecycle event after deletion", null, null, null, null],
]) {
  test(`outbox sequence reconciliation after cold reopen: ${label}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { root, journal } = await createMessageCase(t, {}, { sessionId });
    const target = openTestMessages(journal, sessionId);
    const commitSource = async (operationId, changes) =>
      (
        await commitImmutableSessionChanges(store, {
          operationId,
          expectedGeneration: (await store.snapshot()).generation,
          committedAt,
          changes,
        })
      ).result;
    const commitTarget = async (activeJournal, repository, operationId, changes) => {
      const result = await repository.commit(
        await prepare(activeJournal, repository, operationId, changes),
      );
      assert.equal(result.status, "committed");
      return result.result;
    };
    await commitTarget(journal, target, "messages", {
      messages: [message(0), message(1), message(2)],
    });
    const transition = lifecycleChanges("accept-for-floor");
    const [{ turnTransition: first }, { turnTransition: stagedFirst }] = await Promise.all([
      commitSource("accept-for-floor", transition),
      commitTarget(journal, target, "accept-for-floor", transition),
    ]);
    assert.equal(first.applied, true);
    assert.equal(stagedFirst.applied, true);
    assert.equal(first.header.sequence, 1);
    assert.equal(stagedFirst.header.sequence, 1);
    const envelope = createPluginArtifactEnvelope({
      pluginId: "workflow",
      artifactType: "result",
      artifactId: "sequence-floor",
      sessionId,
      turnScopeId: "t0",
      data: { text: "sequence floor" },
      operation: "created",
      baseRevision: null,
      revision: 1,
      sequence: 1,
      occurredAt: committedAt,
    });
    const { aggregateVersion } = await journal.usingSnapshot((snapshot) =>
      target.readMetadata({ snapshot }),
    );
    const artifactEvents = [
      {
        eventId: envelope.identity.eventId,
        envelope: {
          ...envelope,
          ordering: { ...envelope.ordering, aggregateVersion: aggregateVersion + 1 },
        },
        committedAt,
        deliveries: {},
      },
    ];
    await commitSource("artifact-for-floor", { artifactEvents });
    await commitTarget(journal, target, "artifact-for-floor", { artifactEvents });
    const deletion = {
      messageDeletion: { commandId: "delete-for-floor", anchor: { turnScopeId: "t3" } },
    };
    await commitSource("delete-for-floor", deletion);
    await commitTarget(journal, target, "delete-for-floor", deletion);
    if (side) {
      const collection = "eventSequences";
      const key =
        domain === "session"
          ? sessionLifecycleSequenceKey(sessionId)
          : authorityOutboxSequenceKey(
              envelope.ordering.domain,
              domain === "artifact" ? envelope.ordering.scopeId : "extra",
            );
      const change =
        value === null ? { collection, key, remove: true } : { collection, key, value };
      if (side === "source") {
        await store.commit({
          operationId: "edit-floor",
          expectedGeneration: (await store.snapshot()).generation,
          changes: [change],
        });
      } else {
        const transactions = new PartitionTransactions(journal);
        await journal.usingSnapshot(async (snapshot) => {
          const entry = (
            await transactions.lookupLatestMany({ snapshot, collection, keys: [key] })
          ).get(key);
          const result = await commitFixtureTransaction(transactions, {
            epoch: snapshot.epoch,
            expectedGeneration: snapshot.sequence,
            sequence: snapshot.sequence + 1,
            operationId: "edit-floor",
            input: null,
            mutations: [{ ...change, owner: entry === null ? null : entry.owner }],
            result: null,
          });
          assert.equal(result.status, "committed");
        });
      }
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const verify = () =>
      withImmutableSessionMigrationSource({ sessionDir, expectedSource: null }, (source) =>
        reopened.usingSnapshot((snapshot) =>
          verifyImmutableSessionOutbox({ source, journal: reopened, scope, snapshot }),
        ),
      );
    if (expected) {
      await assert.rejects(verify, {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        message: expected,
      });
      return;
    }
    await verify();
    {
      await using sourceReader = await openImmutableSessionReader({ sessionDir, ...scope });
      await using targetReader = await openPartitionSessionReader({ journal: reopened, ...scope });
      for (const reader of [sourceReader, targetReader]) {
        assert.equal(await reader.readEventSequence("session", sessionId), 2);
        assert.equal(
          await reader.readEventSequence(envelope.ordering.domain, envelope.ordering.scopeId),
          1,
        );
      }
    }
    const next = lifecycleChanges("accept-after-floor", undefined, 4);
    const [sourceNext, targetNext] = await Promise.all([
      commitSource("accept-after-floor", next),
      commitTarget(reopened, openTestMessages(reopened, sessionId), "accept-after-floor", next),
    ]);
    assert.equal(sourceNext.turnTransition.committedEvent.envelope.ordering.sequence, 3);
    assert.equal(targetNext.turnTransition.committedEvent.envelope.ordering.sequence, 3);
    await verify();
  });
}
