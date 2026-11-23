/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { prepareScopedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { importImmutableOperationReceipts } from "../../src/workspace-lifecycle/import-immutable-operation-receipts.js";
import { verifyImmutableSessionStaging } from "../../src/workspace-lifecycle/verify-immutable-session-staging.js";
import { reconcileImmutableSessionStaging } from "../../src/workspace-lifecycle/reconcile-immutable-session-staging.js";
import { verifyImmutableSessionLifecycle } from "../../src/workspace-lifecycle/verify-immutable-session-lifecycle.js";
import { commitImmutableSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { verifyImmutableSessionCommands } from "../../src/workspace-lifecycle/verify-immutable-session-commands.js";
import { immutableAttachmentBindingKey } from "../../src/session/session-artifact-session/immutable-command-index.js";
import { readSessionStorageAuthority } from "../../src/session/session-storage-authority.js";
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
  initializeStaging,
  importStagingMessages,
  targetStorageBudget,
  lifecycleChanges,
  lifecycle,
  noTiming,
  toolPairMessages,
} from "./immutable-session-migration-cases.js";

for (const [field, value, error] of [
  ["sequence", 1, { code: "SESSION_IMMUTABLE_STORAGE_INVALID", message: /lifecycle head differs/ }],
  ["outboxTail", -1, { code: "SESSION_STORAGE_CORRUPT" }],
]) {
  test(`offline staging rejects a persisted lifecycle ${field} mismatch`, async (t) => {
    const { sessionDir } = await migratedWorkspace(t);
    const { journal, root } = await createTransactionCase(t, {}, { sessionId });
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await initializeStaging(journal, source);
        await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
        await importImmutableOperationReceipts({ source, journal, scope });
        const transactions = new PartitionTransactions(journal);
        const collection = "metadata";
        const key = "lifecycle";
        const { owner, mutation } = await journal.usingSnapshot((snapshot) =>
          transactions.withCollectionReader(snapshot, async (read) =>
            (await read({ collection, keys: [key], includeOwner: true })).get(key),
          ),
        );
        const { epoch, sequence } = journal.head;
        const committed = await commitFixtureTransaction(transactions, {
          epoch,
          expectedGeneration: sequence,
          sequence: sequence + 1,
          operationId: `change-${field}`,
          input: null,
          mutations: [{ collection, key, owner, value: { ...mutation.value, [field]: value } }],
          result: null,
        });
        assert.equal(committed.status, "committed");
        await journal.close();
        const reopened = await PartitionJournal.open({ root, sessionId });
        t.after(() => reopened.close());
        const current = join(root, "CURRENT");
        const before = await readFile(current);
        await assert.rejects(
          verifyImmutableSessionStaging({
            source,
            journal: reopened,
            scope,
            limit: 1,
            maxBytes: 4096,
          }),
          error,
        );
        assert.deepEqual(await readFile(current), before);
      },
    );
  });
}

test("empty staging reconciles lifecycle, attachment binding and checkpoints after cold reopen", async (t) => {
  const { sessionDir, store } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(
    t,
    { transactionBytes: 4096 },
    { sessionId },
  );
  const originalGeneration = (await store.snapshot()).generation;
  const commit = async (operationId, changes) =>
    commitImmutableSessionChanges(store, {
      expectedGeneration: (await store.snapshot()).generation,
      operationId,
      committedAt,
      changes,
    });
  const committed = await commit("import-lifecycle-fixture", lifecycle);
  assert.equal(committed.result.turnTransition.applied, true);
  const bound = await commit("bind-m0", bindingChange(message(0), "input.txt", 1));
  assert.equal(bound.result.attachmentBinding.deduplicated, false);
  const { message: persisted } = await store.get(await store.snapshot(), "messages", "m3");
  const checkpoint = parseTurnSummaryCheckpointRequest({
    userId: "u1",
    sessionId,
    turnScopeId: "t3",
    dialogProcessId: "d3",
    checkpointId: "import-checkpoint",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m3"],
    summarizedMessageUids: ["m3"],
    retainedMessageUids: [],
    messages: [persisted],
  });
  const summarized = await commit("import-checkpoint-operation", {
    summaryCheckpoints: [checkpoint],
  });
  assert.equal(summarized.result.summaryCheckpoints[0].committed, true);
  const turn = await store.get(await store.snapshot(), "lifecycle", persisted.turnScopeId);
  assert.equal(turn.presentationMessageId, lifecycle.turnTransition.presentationMessageId);
  await commit("import-tool-pair", {
    messages: toolPairMessages("second-result")
      .slice(1)
      .map((entry) => ({
        ...entry,
        presentationMessageId: turn.presentationMessageId,
      })),
  });
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    (source) => source.identity,
  );
  const authority = await readSessionStorageAuthority(sessionDir);
  assert.equal(journal.head.sequence, 0);
  await journal.close();
  const options = {
    sessionDir,
    stagingDir: root,
    expectedSource,
    targetStorageBudget,
    limit: 1,
    maxBytes: 4096,
  };
  let projection;
  {
    await using sourceReader = await openImmutableSessionReader({ sessionDir, ...scope });
    assert.equal(sourceReader.generation, expectedSource.generation);
    projection = await sourceReader.readDisplayProjection();
    await assert.rejects(reconcileImmutableSessionStaging(options), {
      code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
    });
  }
  const evidence = await reconcileImmutableSessionStaging(options);
  assert.equal(evidence.messageCount, 7);
  assert.equal(evidence.dialogCount, 4);
  assert.equal(evidence.receiptCount, expectedSource.generation);
  const current = join(root, "CURRENT");
  const before = await readFile(current);
  assert.deepEqual(await reconcileImmutableSessionStaging(options), evidence);
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  {
    await using reader = await openPartitionSessionReader({ journal: reopened, ...scope });
    assert.deepEqual(await reader.readDisplayProjection(), projection);
    for (const direction of ["forward", "backward"]) {
      const messages = [];
      let cursor = null;
      do {
        const page = await reader.readDisplayPage({ cursor, direction, limit: 1, maxBytes: 4096 });
        assert.equal(page.generation, reader.generation);
        assert.deepEqual(page.stats, projection.stats);
        if (direction === "forward") messages.push(...page.messages);
        else messages.unshift(...page.messages);
        assert.ok(messages.length <= projection.messages.length);
        if (page.nextCursor !== null) assert.equal(page.messages.length, 1);
        cursor = page.nextCursor;
      } while (cursor !== null);
      const resolved = await Promise.all(
        messages.map(async (message) => {
          if (message.turnPlaceholder) return message;
          const { contentReference, contentBytes, ...facts } = message;
          const body = await reader.readMessageContentPage({
            messageUid: message.messageUid,
            expectedContentReference: contentReference,
            byteOffset: 0,
            maxBytes: contentBytes,
          });
          assert.equal(body.hasMore, false);
          assert.equal(body.totalBytes, contentBytes);
          return {
            ...facts,
            content: JSON.parse(Buffer.from(body.dataBase64, "base64").toString("utf8")),
          };
        }),
      );
      assert.deepEqual(resolved, projection.messages);
    }
  }
  const retry = prepareScopedSessionCommitRequest(
    { epoch: null, expectedGeneration: originalGeneration },
    { operationId: "import-lifecycle-fixture", committedAt, changes: lifecycle },
  );
  assert.deepEqual(await openTestMessages(reopened, sessionId).commit(retry), {
    ...committed,
    replayed: true,
  });
  assert.deepEqual(await readFile(current), before);
  assert.deepEqual(await readSessionStorageAuthority(sessionDir), authority);
});

for (const [label, sourceChanges, targetChanges, mismatch] of [
  ["matching records", lifecycle, lifecycle, null],
  ["missing lifecycle", lifecycle, null, /lifecycle record differs from source: t3/],
  ["extra lifecycle", null, lifecycle, /extra lifecycle record: t3/],
  [
    "different lifecycle",
    lifecycle,
    lifecycleChanges("other", committedAt),
    /lifecycle record differs from source: t3/,
  ],
  ["missing timing", lifecycle, noTiming, /timings record differs from source: t3/],
  ["extra timing", noTiming, lifecycle, /extra timings record: t3/],
  [
    "different timing",
    lifecycle,
    lifecycleChanges("accept", "2026-11-19T00:00:01.000Z"),
    /timings record differs from source: t3/,
  ],
]) {
  test(`lifecycle reconciliation checks persisted ${label}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    if (sourceChanges) {
      const { generation } = await store.snapshot();
      const result = await commitImmutableSessionChanges(store, {
        operationId: "lifecycle-fixture",
        expectedGeneration: generation,
        committedAt,
        changes: sourceChanges,
      });
      assert.equal(
        result.result.turnTransition.applied,
        true,
        JSON.stringify(result.result.turnTransition),
      );
    }
    const { journal, root } = await createMessageCase(t, {}, { sessionId });
    if (targetChanges) {
      const repository = openTestMessages(journal, sessionId);
      const request = await prepare(journal, repository, "lifecycle-fixture", targetChanges);
      const result = await repository.commit(request);
      assert.equal(
        result.result.turnTransition.applied,
        true,
        JSON.stringify(result.result.turnTransition),
      );
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        const verify = () =>
          reopened.usingSnapshot((snapshot) =>
            verifyImmutableSessionLifecycle({ source, journal: reopened, scope, snapshot }),
          );
        if (mismatch)
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

function replacementChanges(newContent) {
  return {
    turnReplacement: {
      command: {
        commandId: "replace-t3",
        anchor: { turnScopeId: "t3" },
        turnScopeId: "t4",
        newContent,
        attachments: [],
      },
      identity: { dialogProcessId: "d4", messageUid: "m4", userMessageId: "u4" },
    },
  };
}

for (const [label, sourceContent, targetContent, mismatch] of [
  ["matching", "edited", "edited", null],
  ["missing", "edited", null, /replacements record differs from source: t3/],
  ["extra", null, "edited", /extra replacements record: t3/],
  ["different", "edited", "other", /replacements record differs from source: t3/],
]) {
  test(`lifecycle reconciliation checks persisted ${label} replacement`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, {}, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    const commitSource = async (operationId, changes) =>
      commitImmutableSessionChanges(store, {
        operationId,
        expectedGeneration: (await store.snapshot()).generation,
        committedAt,
        changes,
      });
    const commitTarget = async (operationId, changes) =>
      repository.commit(await prepare(journal, repository, operationId, changes));
    const seed = { messages: [message(3)] };
    await commitSource("seed-replacement", seed);
    await commitTarget("seed-replacement", seed);
    for (const [commit, content] of [
      [commitSource, sourceContent],
      [commitTarget, targetContent],
    ]) {
      if (content === null) continue;
      const result = await commit("replace", replacementChanges(content));
      assert.deepEqual(
        result.result.turnReplacement.receipt.result.turnReplacement.replacedTurnScopeIds,
        ["t3"],
      );
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        if (!mismatch) {
          await using sourceReader = await openImmutableSessionReader({ sessionDir, ...scope });
          await using targetReader = await openPartitionSessionReader({
            journal: reopened,
            ...scope,
          });
          const selection = { terminalLimit: 0, reconcileTurnScopeIds: ["t3", "t4"] };
          const expected = { t3: await source.readTurnReplacement("t3") };
          assert.equal(expected.t3.replacementTurnScopeId, "t4");
          for (const reader of [sourceReader, targetReader]) {
            const { turnLifecycle } = await reader.readLifecycleSource(selection);
            assert.deepEqual(turnLifecycle.replacedTurns, expected);
          }
        }
        const verify = () =>
          reopened.usingSnapshot((snapshot) =>
            verifyImmutableSessionLifecycle({ source, journal: reopened, scope, snapshot }),
          );
        if (mismatch)
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

function bindingChange(entry, name = "input.txt", expectedAggregateVersion = 0) {
  return {
    attachmentBinding: {
      userId: "u1",
      sessionId,
      turnScopeId: entry.turnScopeId,
      messageUid: entry.messageUid,
      commandId: `bind-${entry.messageUid}`,
      expectedAggregateVersion,
      attachments: [
        {
          attachmentId: entry.messageUid,
          sessionId,
          attachmentSource: "user",
          name,
          mimeType: "text/plain",
        },
      ],
    },
  };
}

async function changeStagedBindingMarker(journal, uid, commandId) {
  const transactions = new PartitionTransactions(journal);
  const collection = PARTITION_MESSAGE_COLLECTIONS.messages;
  await journal.usingSnapshot(async (snapshot) => {
    const slots = await transactions.withCollectionReader(snapshot, (read) =>
      read({ collection, keys: [uid], includeOwner: true }),
    );
    const { owner, mutation } = slots.get(uid);
    const result = await commitFixtureTransaction(transactions, {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      sequence: snapshot.sequence + 1,
      operationId: "alter-staged-binding-marker",
      input: null,
      mutations: [
        {
          collection,
          key: uid,
          owner,
          value: { ...mutation.value, attachmentBindingCommandId: commandId },
        },
      ],
      result: null,
    });
    assert.equal(result.status, "committed");
  });
}

for (const [label, sourceBinds, targetBinds, mismatch] of [
  ["matching", true, true, null],
  ["missing receipt", true, false, /Staged command receipt differs from source: bind-m0/],
  ["extra receipt", false, true, /extra command receipt: bind-m0/],
  ["different receipt", true, true, /Staged command receipt differs from source: bind-m0/],
  ["wrong target owner", true, true, /attachment binding has no matching visible message: bind-m0/],
  ["orphan source index", false, false, /Orphan source attachment binding index/],
  ["orphan target marker", false, false, /Orphan staged attachment binding marker: m0/],
  ["retired suffix", true, true, null],
]) {
  test(`attachment binding reconciliation checks persisted ${label}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, {}, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    const commitSource = async (operationId, changes) =>
      commitImmutableSessionChanges(store, {
        operationId,
        expectedGeneration: (await store.snapshot()).generation,
        committedAt,
        changes,
      });
    const commitTarget = async (operationId, changes) =>
      repository.commit(await prepare(journal, repository, operationId, changes));
    const retained = message(0);
    const removed = { ...message(3), turnScopeId: "t0", dialogProcessId: "d0" };
    const retire = label === "retired suffix";
    for (const entry of retire ? [retained, message(1), message(2), removed] : [retained])
      assert.equal(
        (await commitTarget(`seed-${entry.messageUid}`, { messages: [entry] })).status,
        "committed",
      );
    if (retire) await commitSource("seed-m3", { messages: [removed] });
    if (sourceBinds)
      assert.equal(
        (await commitSource("bind-m0", bindingChange(retained))).result.attachmentBinding
          .deduplicated,
        false,
      );
    if (targetBinds) {
      const changes = bindingChange(retained);
      if (label === "different receipt")
        changes.attachmentBinding.attachments[0].attachmentId = "other";
      assert.equal(
        (await commitTarget("bind-m0", changes)).result.attachmentBinding.deduplicated,
        false,
      );
    }
    if (label === "orphan source index") {
      await store.commit({
        expectedGeneration: (await store.snapshot()).generation,
        operationId: "seed-orphan-binding-index",
        changes: [
          { collection: "commands", key: immutableAttachmentBindingKey("m0"), value: "bind-m0" },
        ],
      });
    }
    if (label === "wrong target owner" || label === "orphan target marker")
      await changeStagedBindingMarker(journal, "m0", "other-binding");
    if (retire) {
      for (const commit of [commitSource, commitTarget]) {
        assert.equal(
          (await commit("bind-m3", bindingChange(removed, "input.txt", 1))).result.attachmentBinding
            .deduplicated,
          false,
        );
      }
      const deletion = {
        messageDeletion: {
          anchor: { turnScopeId: "t1" },
          commandId: "delete",
          expectedAggregateVersion: 2,
        },
      };
      const sourceDeletion = await commitSource("delete", deletion);
      assert.equal(sourceDeletion.result.messageDeletion.receipt.result.deletedCount, 3);
      assert.equal((await commitTarget("delete", deletion)).status, "committed");
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        if (retire) {
          assert.ok(await source.readCommand("bind-m0"));
          assert.equal(await source.readCommand("bind-m3"), null);
          assert.equal(await source.readBindingCommandId("m3"), null);
        }
        const verify = () =>
          reopened.usingSnapshot((snapshot) =>
            verifyImmutableSessionCommands({ source, journal: reopened, scope, snapshot }),
          );
        if (mismatch)
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
