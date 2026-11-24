/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import {
  decodePartitionJournalControl,
  encodePartitionJournalControl,
  PARTITION_JOURNAL_FORMAT,
} from "@noobot/session-protocol/partition-journal";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { journalPartitionPath } from "../src/session/partition-storage/journal-io.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { upgradeWorkspacePartitionFormat } from "../src/workspace-lifecycle/upgrade-workspace-partition-format.js";
import { listQuarantinedUnits } from "../src/workspace-lifecycle/migration-quarantine.js";
import { createMessageCase } from "./session/partition-session-messages.test-helpers.js";

for (const corrupt of [false, true])
  test(`partition upgrade resumes READY stage ${corrupt ? "by rejecting corrupt committed data before publication" : "without converting metadata twice"}`, async (t) => {
    const { journal, root, sessionId } = await createMessageCase(t, {}, { autoClose: false });
    await journal.close();
    const base = join(dirname(root), "workspace");
    const sessionDir = join(base, WORKSPACE_LAYOUT.SESSION_DIR, sessionId);
    await mkdir(dirname(sessionDir), { recursive: true });
    await rename(root, sessionDir);
    const current = join(sessionDir, "CURRENT");
    const legacy = Buffer.from(
      encodePartitionJournalControl({
        ...journal.head,
        format: "noobot.partition-journal-prototype/95",
      }),
    );
    await writeFile(current, legacy);
    const original = await readFile(journalPartitionPath(sessionDir, journal.head.tail.partition));
    const options = {
      base,
      scopedSessionRoots: [],
      targetStorageBudget: { journalLimits: journal.head.limits, maxJournals: 1 },
    };
    const controller = new AbortController();
    const interrupted = new Error("Interrupted after durable READY publication");
    const adapter = getFsAdapter();
    let stage;
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        const result = await adapter.rename(source, target);
        if (basename(target) === "READY") {
          stage = dirname(target);
          controller.abort(interrupted);
        }
        return result;
      },
    });
    try {
      await assert.rejects(
        upgradeWorkspacePartitionFormat({ ...options, signal: controller.signal }),
        (error) => error === interrupted,
      );
    } finally {
      setFsAdapter(adapter);
    }
    assert.ok(stage);
    assert.deepEqual(await readFile(current), legacy);
    const receipt = decodePartitionJournalControl(await readFile(join(stage, "READY"), "utf8"));
    if (corrupt) {
      const file = journalPartitionPath(stage, receipt.target.tail.partition);
      const bytes = await readFile(file);
      bytes[receipt.target.tail.offset - 1] ^= 1;
      await writeFile(file, bytes);
    }
    const result = await upgradeWorkspacePartitionFormat(options);
    if (corrupt) {
      assert.deepEqual(result.upgraded, []);
      assert.equal(result.quarantined.length, 1);
      const [unit] = await listQuarantinedUnits({ base });
      assert.equal(unit.error.code, "SESSION_STORAGE_CORRUPT");
      const preserved = join(base, unit.quarantinePath);
      assert.deepEqual(await readFile(join(preserved, "CURRENT")), legacy);
      assert.deepEqual(
        await readFile(journalPartitionPath(preserved, journal.head.tail.partition)),
        original,
      );
    } else {
      assert.deepEqual(result, { upgraded: [sessionDir], quarantined: [] });
      const head = decodePartitionJournalControl(await readFile(current, "utf8"));
      assert.equal(head.format, PARTITION_JOURNAL_FORMAT);
      assert.deepEqual(head, receipt.target);
      assert.deepEqual(await upgradeWorkspacePartitionFormat(options), {
        upgraded: [],
        quarantined: [],
      });
    }
  });
