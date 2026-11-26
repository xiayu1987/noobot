/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, link, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PARTITION_JOURNAL_PUBLICATION_LOCK } from "@noobot/session-protocol/partition-journal";
import { sessionDeletionStagingName } from "@noobot/workspace-protocol/session-tombstone";
import {
  journalRemovalLockPath,
  removeJournalRemovalLock,
  withJournalRemovalLock,
} from "../../src/session/partition-storage/journal-publication-lock.js";

const executeFile = promisify(execFile);
const windowsOnly = { skip: process.platform !== "win32" };

async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "noobot-removal-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const sessionDir = path.join(directory, "session");
  await mkdir(sessionDir);
  const lockPath = path.join(sessionDir, PARTITION_JOURNAL_PUBLICATION_LOCK);
  await writeFile(lockPath, "");
  return {
    sessionDir,
    lockPath,
    staged: path.join(directory, sessionDeletionStagingName("session")),
  };
}

async function canLockInAnotherProcess(lockPath) {
  const descriptorLock = new URL(
    "../../../platform-compatibility/src/descriptor-lock.js",
    import.meta.url,
  );
  const source = `
    import { open } from "node:fs/promises";
    import { tryAcquireDescriptorLock } from ${JSON.stringify(descriptorLock.href)};
    const handle = await open(process.argv[1], "r+");
    try {
      process.stdout.write(JSON.stringify(await tryAcquireDescriptorLock(handle)));
    } finally {
      await handle.close();
    }
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await executeFile(
    process.execPath,
    ["--input-type=module", "--eval", source, lockPath],
    {
      env,
      timeout: 30000,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout);
}

test(
  "Windows removal renames the session while preserving publication lock exclusion",
  windowsOnly,
  async (context) => {
    const { sessionDir, lockPath, staged } = await fixture(context);
    const internalHandle = await open(lockPath, "r+");
    try {
      await assert.rejects(rename(sessionDir, staged), { code: "EPERM" });
    } finally {
      await internalHandle.close();
    }

    await withJournalRemovalLock(sessionDir, lockPath, async () => {
      assert.equal(await canLockInAnotherProcess(lockPath), false);
      await rename(sessionDir, staged);
      await stat(path.join(staged, PARTITION_JOURNAL_PUBLICATION_LOCK));
    });
    assert.equal(
      await canLockInAnotherProcess(path.join(staged, PARTITION_JOURNAL_PUBLICATION_LOCK)),
      true,
    );
    await rm(staged, { recursive: true });
    await removeJournalRemovalLock(sessionDir);
    await assert.rejects(access(journalRemovalLockPath(sessionDir)), { code: "ENOENT" });
  },
);

test(
  "Windows removal resumes with the same external lock after a failed rename",
  windowsOnly,
  async (context) => {
    const { sessionDir, lockPath, staged } = await fixture(context);
    const failure = Object.assign(new Error("rename interrupted"), { code: "EPERM" });
    await assert.rejects(
      withJournalRemovalLock(sessionDir, lockPath, async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    await stat(journalRemovalLockPath(sessionDir));
    await withJournalRemovalLock(sessionDir, lockPath, () => rename(sessionDir, staged));
    await rm(staged, { recursive: true });
    await removeJournalRemovalLock(sessionDir);
    await assert.rejects(access(journalRemovalLockPath(sessionDir)), { code: "ENOENT" });
  },
);

test(
  "Windows removal rejects an external link to a different publication lock",
  windowsOnly,
  async (context) => {
    const { sessionDir, lockPath } = await fixture(context);
    const unrelated = path.join(path.dirname(sessionDir), "unrelated.lock");
    await writeFile(unrelated, "");
    await link(unrelated, journalRemovalLockPath(sessionDir));
    let invoked = false;
    await assert.rejects(
      withJournalRemovalLock(sessionDir, lockPath, async () => {
        invoked = true;
      }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
    assert.equal(invoked, false);
    await stat(sessionDir);
  },
);
