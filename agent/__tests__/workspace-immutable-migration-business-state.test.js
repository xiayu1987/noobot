/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { bindImmutableMigrationSource } from "@noobot/session-protocol/immutable-storage";
import {
  partitionMigrationAuthorityPath,
  partitionMigrationRoot,
  readImmutableAuthority,
} from "../src/session/session-storage-authority.js";
import { withIsolatedImmutableMigrationSource } from "../src/workspace-lifecycle/with-isolated-immutable-migration-source.js";
import { migrateImmutableSessionToPartition } from "../src/workspace-lifecycle/migrate-immutable-session-to-partition.js";
import { withImmutableSessionMigrationSource } from "../src/workspace-lifecycle/immutable-session-migration-source.js";
import { journalTestLimits } from "./helpers/partition-journal-cases.js";
import { commitImmutableSessionChanges } from "./helpers/commit-immutable-session-fixture.js";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";
import { migrateImmutableSessionSegments } from "../src/session/session-artifact-session/immutable-segment-migration.js";
import {
  createIsolatedMigrationFixture,
  runColdMigrationProcess,
} from "./workspace-isolated-immutable-migration.test-helpers.js";

for (const evidenceCase of ["rotated", "missing", "ambiguous", "wrong-turn"]) {
  test(`offline activity migration with ${evidenceCase} evidence`, async (t) => {
    const {
      options: { sessionDir, scratchRoot },
      store,
      head,
    } = await createIsolatedMigrationFixture(t);
    const user = (await store.get(head, "messages", "m0")).message;
    const presentationMessageId = "msg_legacy";
    const eventId = "model-content:legacy";
    const message = {
      sessionId: user.sessionId,
      parentSessionId: user.parentSessionId,
      dialogProcessId: user.dialogProcessId,
      parentDialogProcessId: user.parentDialogProcessId,
      turnScopeId: user.turnScopeId,
      ts: user.ts,
      type: "message",
      content: "legacy assistant answer",
      attachments: [],
      transferEnvelopes: [],
      role: "assistant",
      messageUid: "legacy-assistant",
      modelMessageId: "legacy-model-message",
      presentationMessageId,
    };
    await commitImmutableSessionChanges(store, {
      operationId: "seed-legacy-assistant",
      expectedGeneration: head.generation,
      committedAt: "2026-01-01T00:00:00.000Z",
      changes: { messages: [message] },
    });
    const seeded = await store.snapshot();
    const record = await store.get(seeded, "messages", message.messageUid);
    await store.commit({
      operationId: "legacy-activity",
      expectedGeneration: seeded.generation,
      changes: [
        {
          collection: "messages",
          key: message.messageUid,
          value: {
            ...record,
            message: {
              ...record.message,
              activityTimeline: [
                {
                  eventId,
                  event: "main_model_content",
                  type: "main_model_content",
                  text: "legacy analysis",
                },
              ],
            },
          },
        },
      ],
    });
    const options = {
      sessionDir,
      expectedSource: bindImmutableMigrationSource(await store.snapshot(), null),
      targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
      limit: 2,
      maxBytes: 4096,
    };
    const evidence = {
      eventId,
      text: "legacy analysis",
      timestamp: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      sequenceDomain: "message-event",
      sequenceScopeId: `msg_event_${presentationMessageId}`,
      sessionId: head.sessionId,
      dialogProcessId: message.dialogProcessId,
      turnScopeId: message.turnScopeId,
      presentationMessageId,
    };
    const event = "main_model_content";
    const line = `${JSON.stringify({
      event,
      data: {
        ...evidence,
        eventType: event,
        turnScopeId: evidenceCase === "wrong-turn" ? "other-turn" : evidence.turnScopeId,
      },
    })}\n`;
    const events = join(sessionDir, "events");
    await mkdir(events);
    if (evidenceCase !== "missing")
      await writeFile(join(events, "system.20260101T000001Z.jsonl"), line);
    if (evidenceCase === "ambiguous") await writeFile(join(events, "system.jsonl"), line);

    await withIsolatedImmutableMigrationSource({ ...options, scratchRoot }, async (replica) => {
      const migration = { ...options, sessionDir: replica.sessionDir };
      const marker = partitionMigrationAuthorityPath(replica.sessionDir);
      if (evidenceCase !== "rotated") {
        const reason = {
          missing: "legacy_activity_evidence_missing",
          ambiguous: "legacy_evidence_ambiguous",
          "wrong-turn": "legacy_activity_evidence_mismatch",
        }[evidenceCase];
        await assert.rejects(migrateImmutableSessionToPartition(migration), (error) => {
          assert.equal(error.code, "WORKSPACE_SESSION_ACTIVITY_TIMELINE_UPGRADE_INVALID");
          assert.equal(error.details.reason, reason);
          assert.equal(error.details.eventId, eventId);
          return true;
        });
        await assert.rejects(stat(marker), { code: "ENOENT" });
        await assert.rejects(stat(partitionMigrationRoot(replica.sessionDir)), { code: "ENOENT" });
        await readImmutableAuthority(replica.sessionDir);
        return;
      }
      const receipt = await migrateImmutableSessionToPartition(migration);
      const moduleUrl = (file) => JSON.stringify(new URL(file, import.meta.url).href);
      const { stdout } = await runColdMigrationProcess(
        `
        import { PartitionJournalOwner } from ${moduleUrl("../src/session/partition-storage/partition-journal-owner.js")};
        import { createPartitionSessionReaderAccess } from ${moduleUrl("../src/session/partition-storage/partition-reader-access.js")};
        import { migrateImmutableSessionToPartition } from ${moduleUrl("../src/workspace-lifecycle/migrate-immutable-session-to-partition.js")};
        const { migration, scratchRoot, messageUid } = JSON.parse(process.argv[1]);
        const receipt = await migrateImmutableSessionToPartition(migration);
        await using owner = new PartitionJournalOwner({
          durableAncestor: scratchRoot, maxJournals: 1, allowNewJournals: false,
        });
        const access = createPartitionSessionReaderAccess({
          acquireJournal: owner.acquire.bind(owner),
          withJournalRemoval: owner.withRemoval.bind(owner),
        });
        await using reader = await access.openArtifact({ sessionDir: migration.sessionDir });
        const [record] = await reader.readMessages({ messageUids: [messageUid] });
        console.log(JSON.stringify({ receipt, message: record.message }));
      `,
        { migration, scratchRoot, messageUid: message.messageUid },
      );
      const reopened = JSON.parse(stdout);
      assert.deepEqual(reopened.receipt, receipt);
      assert.equal(reopened.message.content, message.content);
      assert.deepEqual(reopened.message.activityTimeline, [
        {
          ...evidence,
          activityId: eventId,
          eventType: "model_analysis_delta",
          activityKind: "main_model_analysis",
          authority: "authoritative",
        },
      ]);
    });
    await readImmutableAuthority(sessionDir);
    await assert.rejects(stat(partitionMigrationAuthorityPath(sessionDir)), { code: "ENOENT" });
    assert.deepEqual(await readdir(scratchRoot), []);
  });
}

test("offline cutover rejects a missing checkpoint origin and imports the repaired receipt exactly", async (t) => {
  const {
    options: { sessionDir },
    store: source,
    head: initial,
  } = await createIsolatedMigrationFixture(t);
  const { sessionId } = initial;
  const { message } = await source.get(initial, "messages", "m0");
  const request = {
    operationId: "original-checkpoint",
    expectedGeneration: initial.generation,
    committedAt: message.ts,
    changes: {
      messages: [{ ...message, content: "checkpoint update" }],
      summaryCheckpoints: [
        {
          userId: "u1",
          sessionId,
          dialogProcessId: message.dialogProcessId,
          turnScopeId: message.turnScopeId,
          checkpointId: "cp",
          expectedCheckpointRevision: 0,
          persistedMessageUids: [message.messageUid],
          summarizedMessageUids: [message.messageUid],
          retainedMessageUids: [],
          messages: [{ ...message, content: "checkpoint update" }],
        },
      ],
    },
  };
  const original = await commitImmutableSessionChanges(source, request);
  assert.equal(original.result.summaryCheckpoints[0].messageReceipts.length, 1);
  const head = await source.snapshot();
  const { receipt } = await source.readCommittedOperation(head, request.operationId);
  const duplicate = {
    operationId: "legacy-duplicate-no-origin",
    expectedGeneration: head.generation,
    committedAt: request.committedAt,
    changes: request.changes,
  };
  await source.transact({
    operationId: duplicate.operationId,
    expectedGeneration: head.generation,
    input: { changes: duplicate.changes, committedAt: duplicate.committedAt },
    prepare: async () => ({
      changes: [],
      result: {
        summaryCheckpoints: receipt.result.summaryCheckpoints.map((checkpoint) => ({
          ...checkpoint,
          committed: false,
          deduplicated: true,
          reason: "duplicate_checkpoint",
        })),
      },
    }),
  });
  const before = await source.snapshot();
  const plan = {
    sessionDir,
    expectedSource: bindImmutableMigrationSource(before, null),
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    limit: 2,
    maxBytes: 4096,
  };
  await assert.rejects(migrateImmutableSessionToPartition(plan), {
    code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
  });
  await assert.rejects(stat(partitionMigrationAuthorityPath(sessionDir)), { code: "ENOENT" });
  await assert.rejects(stat(partitionMigrationRoot(sessionDir)), { code: "ENOENT" });
  await readImmutableAuthority(sessionDir);
  assert.deepEqual(await source.snapshot(), before);

  await migrateImmutableSessionSegments({
    sessionDir,
    migrateMessageReceipts: true,
    readOperationInput: () => assert.fail("the duplicate already contains the required identities"),
  });
  const upgraded = await ImmutableSessionStore.open({ sessionDir });
  const after = await upgraded.snapshot();
  assert.equal(after.generation, before.generation);
  const repaired = await commitImmutableSessionChanges(upgraded, duplicate);
  assert.equal(repaired.replayed, true);
  assert.deepEqual(
    repaired.result.summaryCheckpoints[0].messageReceipts,
    original.result.summaryCheckpoints[0].messageReceipts,
  );
  const migration = { ...plan, expectedSource: bindImmutableMigrationSource(after, null) };
  const published = await migrateImmutableSessionToPartition(migration);
  assert.deepEqual(published.source, migration.expectedSource);
  const moduleUrl = (file) => JSON.stringify(new URL(file, import.meta.url).href);
  const { stdout } = await runColdMigrationProcess(
    `
    import { PartitionJournal } from ${moduleUrl("../src/session/partition-storage/partition-journal.js")};
    import { PartitionSessionMessages } from ${moduleUrl("../src/session/partition-storage/partition-session-messages.js")};
    import { readPartitionStorageRoot } from ${moduleUrl("../src/session/session-storage-authority.js")};
    import { prepareScopedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
    const { sessionDir, duplicate: { expectedGeneration, ...command }, scope } = JSON.parse(process.argv[1]);
    const root = await readPartitionStorageRoot(sessionDir);
    const journal = await PartitionJournal.open({ root, sessionId: scope.sessionId });
    try {
      const messages = new PartitionSessionMessages(journal, scope);
      const request = prepareScopedSessionCommitRequest({ epoch: null, expectedGeneration }, command);
      const before = journal.head.sequence;
      const replay = await messages.commit(request);
      console.log(JSON.stringify({ replay, before, after: journal.head.sequence }));
    } finally { await journal.close(); }
  `,
    { sessionDir, duplicate, scope: { sessionId, parentSessionId: "", caller: "user" } },
  );
  const cold = JSON.parse(stdout);
  assert.equal(cold.replay.replayed, true);
  assert.equal(cold.replay.generation, repaired.generation);
  assert.equal(cold.replay.commit, repaired.commit);
  assert.deepEqual(cold.replay.result, repaired.result);
  assert.equal(cold.after, cold.before);
});

test("offline migration preserves sparse dialog ordinals and the allocation high-water mark", async (t) => {
  const {
    options: { sessionDir, scratchRoot },
    store,
    head,
  } = await createIsolatedMigrationFixture(t);
  const template = (await store.get(head, "messages", "m0")).message;
  const append = (index) => ({
    ...template,
    messageUid: `m${index}`,
    userMessageId: `u${index}`,
    dialogProcessId: `d${index}`,
    turnScopeId: `t${index}`,
  });
  const commit = async (operationId, changes) => {
    const { generation } = await store.snapshot();
    await commitImmutableSessionChanges(store, {
      operationId,
      expectedGeneration: generation,
      committedAt: template.ts,
      changes,
    });
    assert.equal((await store.snapshot()).generation, generation + 1);
  };
  const remove = (index, expectedAggregateVersion) =>
    commit(`delete-${index}`, {
      messageDeletion: {
        commandId: `delete-${index}`,
        anchor: { turnScopeId: `t${index}` },
        expectedAggregateVersion,
      },
    });
  await remove(1, 0);
  await commit("append-after-hole", { messages: [append(3), append(4)] });
  await remove(4, 1);
  const beforeClassification = await store.snapshot();
  const registered = await store.get(beforeClassification, "messages", "m3");
  await store.commit({
    operationId: "classify-historical-dialog-user",
    expectedGeneration: beforeClassification.generation,
    changes: [
      {
        collection: "messages",
        key: "m3",
        value: { ...registered, message: { ...registered.message, messageOrigin: "internal" } },
      },
    ],
  });
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      assert.equal((await source.readDialog("d3")).dialogOrdinal, 4);
      assert.equal((await source.readDialog("d3")).userMessageUid, "m3");
      assert.equal(await source.readDialog("d4"), null);
      assert.equal(await source.readDialogSequence(), 5);
      return source.identity;
    },
  );
  await withIsolatedImmutableMigrationSource(
    { sessionDir, scratchRoot, expectedSource },
    async (replica) => {
      const migration = {
        sessionDir: replica.sessionDir,
        expectedSource,
        targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
        limit: 1,
        maxBytes: 4096,
      };
      const receipt = await migrateImmutableSessionToPartition(migration);
      const moduleUrl = (file) => JSON.stringify(new URL(file, import.meta.url).href);
      const { stdout } = await runColdMigrationProcess(
        `
      import { PartitionJournal } from ${moduleUrl("../src/session/partition-storage/partition-journal.js")};
      import { PartitionSessionMessages } from ${moduleUrl("../src/session/partition-storage/partition-session-messages.js")};
      import { PartitionSessionStateReader } from ${moduleUrl("../src/session/partition-storage/partition-session-state-reader.js")};
      const { root, message } = JSON.parse(process.argv[1]);
      const scope = { sessionId: message.sessionId, parentSessionId: message.parentSessionId, caller: "user" };
      const journal = await PartitionJournal.open({ root, sessionId: scope.sessionId });
      try {
        const state = new PartitionSessionStateReader(journal, scope);
        const old = await journal.usingSnapshot((snapshot) => state.readDialog(snapshot, "d3"));
        const messages = new PartitionSessionMessages(journal, scope);
        const request = await journal.usingSnapshot((snapshot) => messages.prepareRequest(snapshot, {
          operationId: "append-after-migration", committedAt: message.ts, changes: { messages: [message] },
        }));
        const { status } = await messages.commit(request);
        const next = await journal.usingSnapshot((snapshot) => state.readDialog(snapshot, "d5"));
        console.log(JSON.stringify({ old, next, status }));
      } finally { await journal.close(); }
    `,
        { root: partitionMigrationRoot(migration.sessionDir), message: append(5) },
      );
      const { old, next, status } = JSON.parse(stdout);
      assert.deepEqual(receipt.source, expectedSource);
      assert.equal(old.dialogOrdinal, 4);
      assert.equal(old.userMessageUid, "m3");
      assert.equal(status, "committed");
      assert.equal(next.dialogOrdinal, 6);
    },
  );
});
