/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { partitionMessageEntryKey } from "@noobot/session-protocol/partition-session-messages";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction } from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { verifyImmutableSessionMessages } from "../../src/workspace-lifecycle/verify-immutable-session-messages.js";
import { verifyImmutableSessionDialogs } from "../../src/workspace-lifecycle/verify-immutable-session-dialogs.js";
import { commitImmutableSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { verifyImmutableSessionToolPairs } from "../../src/workspace-lifecycle/verify-immutable-session-tool-pairs.js";
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
  toolPairMessages,
} from "./immutable-session-migration-cases.js";

for (const [label, messages, mismatch] of [
  ["matches after cold reopen", [message(0), message(1), message(2)], null],
  ["rejects a different body", [message(0), message(1, "different"), message(2)], /differs.*2$/],
  ["rejects reordered messages", [message(0), message(2), message(1)], /differs.*2$/],
  ["rejects a missing tail", [message(0), message(1)], /differs.*3$/],
  ["rejects an extra tail", [message(0), message(1), message(2), message(3)], /extra.*4$/],
]) {
  test(`migration message verification ${label}`, async (t) => {
    const { sessionDir } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, {}, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    for (const entry of messages) {
      await repository.commit(
        await prepare(journal, repository, `append-${entry.messageUid}`, { messages: [entry] }),
      );
    }
    await journal.close();
    const staging = await PartitionJournal.open({ root, sessionId });
    t.after(() => staging.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        const verify = () =>
          staging.usingSnapshot((snapshot) =>
            verifyImmutableSessionMessages({
              source,
              journal: staging,
              snapshot,
              scope,
              limit: 1,
              maxBytes: 4096,
            }),
          );
        if (mismatch)
          await assert.rejects(verify, {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message: mismatch,
          });
        else assert.equal(await verify(), messages.length);
      },
    );
    assert.deepEqual(await readFile(current), before);
  });
}

for (const [label, entries, mismatch] of [
  ["missing dialog", [message(0), message(1)], /^Staged dialog is missing: d2$/],
  ["extra dialog", [message(0), message(1), message(2), message(3)], /extra dialog: d3/],
  ["dialog order", [message(1), message(0), message(2)], /differs from source: d0/],
  [
    "turn membership",
    [message(0), message(1), message(2), { ...message(3), dialogProcessId: "d0" }],
    /turn membership differs: d0/,
  ],
]) {
  test(`dialog verification rejects persisted ${label}`, async (t) => {
    const { sessionDir } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, {}, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    for (const entry of entries) {
      const request = await prepare(journal, repository, `append-${entry.messageUid}`, {
        messages: [entry],
      });
      assert.equal((await repository.commit(request)).status, "committed");
    }
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await assert.rejects(
          reopened.usingSnapshot((snapshot) =>
            verifyImmutableSessionDialogs({
              source,
              journal: reopened,
              snapshot,
              scope,
              limit: 1,
              maxBytes: 4096,
            }),
          ),
          { code: "SESSION_IMMUTABLE_STORAGE_INVALID", message: mismatch },
        );
      },
    );
  });
}

for (const swap of [false, true]) {
  test(`dialog reconciliation ${swap ? "rejects cross-page reordering" : "ignores repeated and retired directory keys"}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, { partitionRecords: 1 }, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    const moreTurns = [3, 4].map((index) => ({ ...message(index), dialogProcessId: "d0" }));
    await commitImmutableSessionChanges(store, {
      operationId: "append-source-dialog-turns",
      expectedGeneration: (await store.snapshot()).generation,
      committedAt,
      changes: { messages: moreTurns },
    });
    for (const entry of [message(0), message(1), message(2), ...moreTurns, message(5)]) {
      const request = await prepare(journal, repository, `append-${entry.messageUid}`, {
        messages: [entry],
      });
      assert.equal((await repository.commit(request)).status, "committed");
    }
    const deletion = await prepare(journal, repository, "delete-extra-dialog", {
      messageDeletion: { commandId: "delete-extra-dialog", anchor: { turnScopeId: "t5" } },
    });
    assert.equal((await repository.commit(deletion)).status, "committed");
    if (swap) {
      const transactions = new PartitionTransactions(journal);
      const collection = "dialogTurns";
      const keys = [2, 3].map((ordinal) => partitionMessageEntryKey(collection, "d0", ordinal));
      const slots = await journal.usingSnapshot((snapshot) =>
        transactions.withCollectionReader(snapshot, (read) =>
          read({ collection, keys, includeOwner: true }),
        ),
      );
      const { epoch, sequence } = journal.head;
      const result = await commitFixtureTransaction(transactions, {
        epoch,
        expectedGeneration: sequence,
        sequence: sequence + 1,
        operationId: "swap-dialog-turn-slots",
        input: null,
        mutations: keys.map((key, index) => ({
          collection,
          key,
          owner: slots.get(key).owner,
          value: slots.get(keys[1 - index]).mutation.value,
        })),
        result: null,
      });
      assert.equal(result.status, "committed");
    }

    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await reopened.usingSnapshot(async (snapshot) => {
          const seen = new Map();
          await new PartitionTransactions(reopened).visitCollectionKeys(
            snapshot,
            ["dialogs"],
            (key) => {
              seen.set(key, (seen.get(key) ?? 0) + 1);
            },
          );
          assert.ok(seen.get("d0") > 1);
          assert.ok(seen.has("d5"));
          const verify = () =>
            verifyImmutableSessionDialogs({
              source,
              journal: reopened,
              snapshot,
              scope,
              limit: 1,
              maxBytes: 4096,
            });
          if (swap)
            await assert.rejects(verify, {
              code: "SESSION_IMMUTABLE_STORAGE_INVALID",
              message: /turn membership differs: d0/,
            });
          else assert.equal(await verify(), 3);
        });
      },
    );
    assert.deepEqual(await readFile(current), before);
  });
}

for (const [label, expectedUid, actualUid, retired, mismatch] of [
  ["matching results across partitions", "second-result", "second-result", false, null],
  [
    "equal counts with different result UIDs",
    "second-result",
    "other-result",
    false,
    /result differs from source: other-result/,
  ],
  ["missing pair", "second-result", null, false, /tool pair differs from source/],
  ["extra pair", null, "second-result", false, /extra tool pair/],
  ["retired slots across partitions", null, "second-result", true, null],
]) {
  test(`tool pair reconciliation checks persisted ${label}`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createMessageCase(t, { partitionRecords: 1 }, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    if (expectedUid) {
      await commitImmutableSessionChanges(store, {
        operationId: "seed-source-tool-pair",
        expectedGeneration: (await store.snapshot()).generation,
        committedAt,
        changes: { messages: toolPairMessages(expectedUid) },
      });
    }
    if (actualUid) {
      for (const entry of toolPairMessages(actualUid)) {
        const request = await prepare(journal, repository, `seed-${entry.messageUid}`, {
          messages: [entry],
        });
        assert.equal((await repository.commit(request)).status, "committed");
      }
    }
    if (retired) {
      const request = await prepare(journal, repository, "delete-tool-turn", {
        messageDeletion: { commandId: "delete-tool-turn", anchor: { turnScopeId: "t3" } },
      });
      assert.equal((await repository.commit(request)).status, "committed");
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
            verifyImmutableSessionToolPairs({ source, journal: reopened, scope, snapshot }),
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
