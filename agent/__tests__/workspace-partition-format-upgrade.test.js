/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  encodePartitionJournalControl,
  PARTITION_JOURNAL_FORMAT,
} from "@noobot/session-protocol/partition-journal";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { PARTITION_TITLE_CANDIDATES_ROOT } from "@noobot/session-protocol/partition-title-index";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { journalPartitionPath } from "../src/session/partition-storage/journal-io.js";
import { PartitionJournal } from "../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { upgradeWorkspacePartitionFormat } from "../src/workspace-lifecycle/upgrade-workspace-partition-format.js";
import { commitFixtureTransaction } from "./helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  openTestMessages,
  prepare,
  scope,
} from "./session/partition-session-messages.test-helpers.js";

test("v47 rebuilds title membership and resumes after a failed CURRENT publication", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t, {}, { autoClose: false });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "user-message", {
      messages: [
        {
          ...scope,
          sessionId,
          messageUid: "message-1",
          userMessageId: "user-message-1",
          role: "user",
          type: "message",
          messageOrigin: "natural",
          content: "Title from history",
          attachments: [],
          ts: committedAt,
        },
      ],
    }),
  );
  const transactions = new PartitionTransactions(journal);
  const mutations = await journal.usingSnapshot((snapshot) =>
    transactions.withCollectionReader(snapshot, async (read) => {
      const readEntry = ({ collection, key }) =>
        read({ collection, keys: [key], includeOwner: true }).then((entries) => entries.get(key));
      const metadata = await readEntry(PARTITION_SESSION_METADATA);
      const index = await readEntry(PARTITION_TITLE_CANDIDATES_ROOT);
      return [
        {
          ...PARTITION_SESSION_METADATA,
          owner: metadata.owner,
          value: { ...metadata.mutation.value, autoTitle: "Old title" },
        },
        { ...PARTITION_TITLE_CANDIDATES_ROOT, owner: index.owner, remove: true },
      ];
    }),
  );
  const { epoch, sequence } = journal.head;
  await commitFixtureTransaction(transactions, {
    epoch,
    expectedGeneration: sequence,
    sequence: sequence + 1,
    operationId: "legacy-metadata",
    input: {},
    mutations,
    result: {},
  });
  await journal.close();
  const legacy = Buffer.from(
    encodePartitionJournalControl({
      ...journal.head,
      format: "noobot.partition-journal-prototype/93",
    }),
  );
  const base = join(dirname(root), "workspace");
  const sessionDir = join(base, WORKSPACE_LAYOUT.SESSION_DIR, sessionId);
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await mkdir(dirname(sessionDir), { recursive: true });
  await rename(root, sessionDir);
  const current = join(sessionDir, "CURRENT");
  await writeFile(current, legacy);
  await writeFile(state, JSON.stringify({ version: 46 }));
  const originalPartition = await readFile(journalPartitionPath(sessionDir, 0));
  const options = {
    base,
    scopedSessionRoots: [],
    targetStorageBudget: { journalLimits: journal.head.limits, maxJournals: 1 },
  };

  const adapter = getFsAdapter();
  setFsAdapter({
    ...adapter,
    async rename(source, target) {
      if (target === current)
        throw Object.assign(new Error("Injected publication failure"), { code: "EIO" });
      return adapter.rename(source, target);
    },
  });
  try {
    const [result] = await upgradeWorkspaceLayout(options);
    assert.equal(result.failed?.code, "EIO");
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(JSON.parse(await readFile(state, "utf8")).version, 46);
  assert.deepEqual(await readFile(current), legacy);

  const [result] = await upgradeWorkspaceLayout(options);
  assert.deepEqual(result.result, { upgraded: [sessionDir] });
  assert.equal(JSON.parse(await readFile(state, "utf8")).version, 47);
  const reopened = await PartitionJournal.open({ root: sessionDir, sessionId });
  try {
    assert.equal(reopened.head.format, PARTITION_JOURNAL_FORMAT);
    assert.equal(reopened.head.epoch, epoch);
    assert.equal(reopened.head.sequence, sequence + 2);
    const partition = await readFile(journalPartitionPath(sessionDir, 0));
    assert.deepEqual(partition.subarray(0, originalPartition.length), originalPartition);
    await using reader = await openPartitionSessionReader({
      journal: reopened,
      sessionId,
      parentSessionId: "",
    });
    const metadata = await reader.readMetadata();
    assert.equal(Object.hasOwn(metadata, "autoTitle"), false);
    assert.equal(
      (await reader.readMetadata({ includeAutoTitle: true })).autoTitle,
      "Title from history",
    );
  } finally {
    await reopened.close();
  }
  assert.deepEqual(await upgradeWorkspaceLayout(options), []);
  let processed = 0;
  const published = await readFile(current);
  assert.deepEqual(
    await upgradeWorkspacePartitionFormat({
      ...options,
      onSessionProcessed: () => {
        processed += 1;
      },
    }),
    { upgraded: [] },
  );
  assert.equal(processed, 1);
  assert.deepEqual(await readFile(current), published);
});
