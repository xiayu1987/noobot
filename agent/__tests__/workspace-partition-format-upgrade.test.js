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
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import { normalizeMigrationQuarantinePath } from "@noobot/workspace-protocol/migration-quarantine";
import { journalPartitionPath } from "../src/session/partition-storage/journal-io.js";
import { PartitionJournal } from "../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../src/session/partition-storage/partition-session-reader.js";
import { PartitionTransactions } from "../src/session/partition-storage/partition-transactions.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { upgradeWorkspaceLayout } from "../src/workspace-lifecycle/sections.js";
import { upgradeWorkspacePartitionFormat } from "../src/workspace-lifecycle/upgrade-workspace-partition-format.js";
import { listQuarantinedUnits } from "../src/workspace-lifecycle/migration-quarantine.js";
import { commitFixtureTransaction } from "./helpers/partition-journal-cases.js";
import {
  committedAt,
  createMessageCase,
  openTestMessages,
  prepare,
  scope,
} from "./session/partition-session-messages.test-helpers.js";

for (const [format, version] of [
  [93, 46],
  [95, 47],
  [95, 48],
]) {
  for (const failure of [
    null,
    "publication",
    "version",
    "revision",
    "settings",
    "turnStatuses",
    "mutationReceipts",
    "messages",
    "dialogOrder",
    "turnTimings",
    "sessionArtifactEvents",
    "turnLifecycle",
    "turnSummaryCheckpoints",
    ...(format === 95
      ? ["title-index", "title-empty", "title-missing-first", "title-missing-last", "title-extra"]
      : []),
  ])
    test(`partition ${format} layout ${version} upgrade ${failure ? `quarantines ${failure} failure without blocking the workspace` : "preserves history and removes retired projections"}`, async (t) => {
      const { journal, root, sessionId } = await createMessageCase(t, {}, { autoClose: false });
      const messages = openTestMessages(journal, sessionId);
      await messages.commit(
        await prepare(journal, messages, "user-message", {
          messages: [1, 2].map((ordinal) => ({
            ...scope,
            sessionId,
            messageUid: `message-${ordinal}`,
            userMessageId: `user-message-${ordinal}`,
            role: "user",
            type: "message",
            messageOrigin: "natural",
            content: ordinal === 1 ? "Title from history" : "Second title candidate",
            attachments: [],
            ts: committedAt,
          })),
        }),
      );
      const transactions = new PartitionTransactions(journal);
      const mutations = await journal.usingSnapshot((snapshot) =>
        transactions.withCollectionReader(snapshot, async (read) => {
          const readEntry = ({ collection, key }) =>
            read({ collection, keys: [key], includeOwner: true }).then((entries) =>
              entries.get(key),
            );
          const metadata = await readEntry(PARTITION_SESSION_METADATA);
          const index = await readEntry(PARTITION_TITLE_CANDIDATES_ROOT);
          return [
            {
              ...PARTITION_SESSION_METADATA,
              owner: metadata.owner,
              value: {
                ...metadata.mutation.value,
                ...(format === 93 ? { autoTitle: "Old title" } : {}),
                sessionArtifacts: [{ retired: true }],
                turnTerminalCommits: { retired: true },
                shortMemoryCheckpoint: "7",
                ...(failure === "version"
                  ? { version: metadata.mutation.value.aggregateVersion + 1 }
                  : {}),
                ...(failure === "revision"
                  ? { revision: metadata.mutation.value.aggregateVersion + 1 }
                  : {}),
                ...(failure === "settings"
                  ? { selectedConnectorIds: ["duplicate", "duplicate"] }
                  : {}),
                ...([
                  "turnStatuses",
                  "mutationReceipts",
                  "messages",
                  "dialogOrder",
                  "turnTimings",
                  "sessionArtifactEvents",
                  "turnLifecycle",
                  "turnSummaryCheckpoints",
                ].includes(failure)
                  ? { [failure]: [{ unverified: true }] }
                  : {}),
              },
            },
            ...(format === 93 || failure === "title-index"
              ? [{ ...PARTITION_TITLE_CANDIDATES_ROOT, owner: index.owner, remove: true }]
              : []),
            ...([
              "title-empty",
              "title-missing-first",
              "title-missing-last",
              "title-extra",
            ].includes(failure)
              ? [
                  {
                    ...PARTITION_TITLE_CANDIDATES_ROOT,
                    owner: index.owner,
                    value: {
                      ordinals: {
                        "title-empty": [],
                        "title-missing-first": [2],
                        "title-missing-last": [1],
                        "title-extra": [1, 2, 3],
                      }[failure],
                    },
                  },
                ]
              : []),
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
          format: `noobot.partition-journal-prototype/${format}`,
        }),
      );
      const base = join(dirname(root), "workspace");
      const sessionDir = join(base, WORKSPACE_LAYOUT.SESSION_DIR, sessionId);
      const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
      await mkdir(dirname(sessionDir), { recursive: true });
      await rename(root, sessionDir);
      const current = join(sessionDir, "CURRENT");
      await writeFile(current, legacy);
      await writeFile(state, JSON.stringify({ version }));
      const originalPartition = await readFile(journalPartitionPath(sessionDir, 0));
      const options = {
        base,
        backupBase: join(base, "backups"),
        scopedSessionRoots: [],
        targetStorageBudget: { journalLimits: journal.head.limits, maxJournals: 1 },
      };

      const adapter = getFsAdapter();
      setFsAdapter({
        ...adapter,
        async rename(source, target) {
          if (failure === "publication" && target === current)
            throw Object.assign(new Error("Injected publication failure"), { code: "EIO" });
          return adapter.rename(source, target);
        },
      });
      try {
        const results = await upgradeWorkspaceLayout(options);
        assert.equal(
          results.some((result) => result.failed),
          false,
        );
        const upgradeId =
          version < 47 ? "session-partition-format-v47" : "session-partition-metadata-v49";
        const { result } = results.find((result) => result.id === upgradeId);
        assert.deepEqual(result.upgraded, failure ? [] : [sessionDir]);
        assert.equal(result.quarantined.length, failure ? 1 : 0);
      } finally {
        setFsAdapter(adapter);
      }
      assert.equal(JSON.parse(await readFile(state, "utf8")).version, WORKSPACE_LAYOUT_VERSION);
      assert.deepEqual(await upgradeWorkspaceLayout(options), []);
      if (failure) {
        const [unit] = await listQuarantinedUnits({ base });
        assert.deepEqual(unit.sessionStorage, { format: "partition", status: "upgrade-failed" });
        assert.equal(
          unit.error.code,
          failure === "publication" ? "EIO" : "SESSION_STORAGE_CORRUPT",
        );
        const preserved = join(base, unit.quarantinePath);
        assert.deepEqual(await readFile(join(preserved, "CURRENT")), legacy);
        const partition = await readFile(journalPartitionPath(preserved, 0));
        assert.deepEqual(partition.subarray(0, originalPartition.length), originalPartition);
        await assert.rejects(readFile(current), { code: "ENOENT" });
        return;
      }
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
        for (const field of ["sessionArtifacts", "turnTerminalCommits", "shortMemoryCheckpoint"])
          assert.equal(Object.hasOwn(metadata, field), false);
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
        { upgraded: [], quarantined: [] },
      );
      assert.equal(processed, 1);
      assert.deepEqual(await readFile(current), published);
    });
}

test("mixed unsupported, corrupt and conflicting sessions do not block a healthy partition upgrade", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t, {}, { autoClose: false });
  const transactions = new PartitionTransactions(journal);
  const index = await journal.usingSnapshot((snapshot) =>
    transactions.withCollectionReader(snapshot, async (read) => {
      const { collection, key } = PARTITION_TITLE_CANDIDATES_ROOT;
      return (await read({ collection, keys: [key], includeOwner: true })).get(key);
    }),
  );
  await commitFixtureTransaction(transactions, {
    epoch: journal.head.epoch,
    expectedGeneration: journal.head.sequence,
    sequence: journal.head.sequence + 1,
    operationId: "prepare-legacy-title-format",
    input: {},
    mutations: [{ ...PARTITION_TITLE_CANDIDATES_ROOT, owner: index.owner, remove: true }],
    result: {},
  });
  await journal.close();
  const base = join(dirname(root), "mixed-workspace");
  const sessionDir = join(base, WORKSPACE_LAYOUT.SESSION_DIR, sessionId);
  await mkdir(dirname(sessionDir), { recursive: true });
  await rename(root, sessionDir);
  await writeFile(
    join(sessionDir, "CURRENT"),
    encodePartitionJournalControl({
      ...journal.head,
      format: "noobot.partition-journal-prototype/93",
    }),
  );
  const failures = [
    ["old-immutable", { "head.json": "old bytes" }, "immutable", "unsupported-format"],
    ["old-document", { "session.json": "old document" }, "document", "unsupported-format"],
    ["bad-marker", { "session-authority": "invalid marker" }, "partition", "upgrade-failed"],
    [
      "dual-authority",
      { CURRENT: "partition bytes", "head.json": "old bytes" },
      "conflicting",
      "upgrade-failed",
    ],
    ["bad-partition", { CURRENT: "invalid partition head" }, "partition", "upgrade-failed"],
  ];
  for (const [id, files] of failures) {
    const directory = join(base, WORKSPACE_LAYOUT.SESSION_DIR, id);
    await mkdir(directory);
    for (const [name, bytes] of Object.entries(files))
      await writeFile(join(directory, name), bytes);
  }
  const state = join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await writeFile(state, JSON.stringify({ version: 46 }));
  const options = {
    base,
    scopedSessionRoots: [],
    targetStorageBudget: { journalLimits: journal.head.limits, maxJournals: 1 },
  };
  const results = await upgradeWorkspaceLayout(options);
  assert.equal(
    results.some((result) => result.failed),
    false,
  );
  assert.equal(JSON.parse(await readFile(state, "utf8")).version, WORKSPACE_LAYOUT_VERSION);
  const units = await listQuarantinedUnits({ base });
  assert.equal(units.length, failures.length, JSON.stringify(units));
  for (const [id, files, format, status] of failures) {
    const expectedPath = normalizeMigrationQuarantinePath(join(WORKSPACE_LAYOUT.SESSION_DIR, id));
    const unit = units.find((entry) => entry.path === expectedPath);
    assert.deepEqual(unit.sessionStorage, { format, status });
    for (const [name, bytes] of Object.entries(files))
      assert.equal(await readFile(join(base, unit.quarantinePath, name), "utf8"), bytes);
  }
  const reopened = await PartitionJournal.open({ root: sessionDir, sessionId });
  try {
    assert.equal(reopened.head.format, PARTITION_JOURNAL_FORMAT);
    await using reader = await openPartitionSessionReader({
      journal: reopened,
      sessionId,
      parentSessionId: "",
    });
    assert.equal((await reader.readMetadata()).sessionId, sessionId);
  } finally {
    await reopened.close();
  }
  const tree = JSON.parse(await readFile(join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE), "utf8"));
  assert.deepEqual(Object.keys(tree.nodes), [sessionId]);
  assert.deepEqual(await upgradeWorkspaceLayout(options), []);
  assert.deepEqual(await listQuarantinedUnits({ base }), units);
});
