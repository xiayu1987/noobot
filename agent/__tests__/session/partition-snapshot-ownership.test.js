/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { filePath as path } from "@noobot/path-resolver";
import { PARTITION_JOURNAL_DIRECTORIES } from "@noobot/session-protocol/partition-journal";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { withUnretainedJournal } from "../../src/session/partition-storage/journal-snapshots.js";
import { createJournalCase } from "../helpers/partition-journal-cases.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const source = `
  import { PartitionJournal } from ${JSON.stringify(new URL("../../src/session/partition-storage/partition-journal.js", import.meta.url).href)};
  import { getFsAdapter, setFsAdapter } from ${JSON.stringify(new URL("../../src/shared/storage/fs-adapter.js", import.meta.url).href)};
  import { basename } from "node:path";
  const { boundary, exitDuringRelease, ...options } = JSON.parse(process.argv[1]);
  const journal = await PartitionJournal.open(options);
  if (boundary) {
    const adapter = getFsAdapter();
    setFsAdapter({ ...adapter, async rename(from, to) {
      if (basename(to) !== "0.json") return adapter.rename(from, to);
      if (boundary === "after") await adapter.rename(from, to);
      process.exit(44);
    }});
  }
  const snapshot = await journal.snapshot();
  process.send({ sequence: snapshot.sequence });
  process.on("message", async () => {
    if (exitDuringRelease) {
      const adapter = getFsAdapter();
      setFsAdapter({ ...adapter, async rm(file, ...args) {
        await adapter.rm(file, ...args);
        if (basename(file) === "0.json") process.exit(45);
      }});
    }
    await journal.releaseSnapshot(snapshot);
    await journal.close();
    process.disconnect();
  });
`;

async function startOwner(t, options) {
  const child = fork("--eval", [source, JSON.stringify(options)], {
    execArgv: [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
    ],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exit = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
  });
  return { child, exit };
}

test(
  "live and stopped snapshot owners prevent reuse; process death releases the orphan slot",
  {
    timeout: 15000,
  },
  async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, { retentionRecords: 1 });
    const { child, exit } = await startOwner(t, { root, sessionId });
    const ready = await Promise.race([once(child, "message").then(([value]) => value), exit]);
    assert.deepEqual(ready, { sequence: 0 });
    const lock = path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentionOwners, "0.lock");
    const inode = (await stat(lock)).ino;
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    await assert.rejects(reopened.snapshot(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
    if (process.platform !== "win32") {
      child.kill("SIGSTOP");
      await assert.rejects(journal.snapshot(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
    }
    child.kill("SIGKILL");
    await exit;
    const recovered = await PartitionJournal.open({ root, sessionId });
    t.after(() => recovered.close());
    assert.deepEqual(await readdir(path.join(root, "retentions")), []);
    await recovered.usingSnapshot(() => {});
    assert.equal((await stat(lock)).ino, inode);
  },
);

test(
  "an existing writer makes abandoned snapshot deletion durable before reusing the slot",
  { timeout: 15000 },
  async (t) => {
    const { journal, root, sessionId } = await createJournalCase(t, { retentionRecords: 1 });
    const { child, exit } = await startOwner(t, { root, sessionId, exitDuringRelease: true });
    const ready = await Promise.race([once(child, "message").then(([value]) => value), exit]);
    assert.deepEqual(ready, { sequence: 0 });
    child.send({});
    assert.deepEqual(await exit, [45, null]);

    const directory = path.join(root, "retentions");
    assert.deepEqual(await readdir(directory), []);
    const adapter = getFsAdapter();
    const failure = Object.assign(new Error("Retention directory sync failed"), { code: "EIO" });
    setFsAdapter({
      ...adapter,
      async syncDirectory(target) {
        if (target === directory) throw failure;
        return adapter.syncDirectory(target);
      },
    });
    try {
      await assert.rejects(journal.snapshot(), (error) => error === failure);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      setFsAdapter(adapter);
    }
    await journal.usingSnapshot(async () => {
      assert.deepEqual(await readdir(directory), ["0.json"]);
    });
    assert.deepEqual(await readdir(directory), []);
  },
);

test("ownership directory sync failure closes the lock and rejects retention publication", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  await journal.usingSnapshot(() => {});
  const ownerDirectory = path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentionOwners);
  const inode = (await stat(path.join(ownerDirectory, "0.lock"))).ino;
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("Ownership directory sync failed"), { code: "EIO" });
  let injected = false;
  setFsAdapter({
    ...adapter,
    async syncDirectory(directory) {
      if (directory === ownerDirectory) {
        injected = true;
        throw failure;
      }
      return adapter.syncDirectory(directory);
    },
  });
  try {
    await assert.rejects(journal.snapshot(), (error) => error === failure);
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  await journal.usingSnapshot(() => {});
  assert.equal((await stat(path.join(ownerDirectory, "0.lock"))).ino, inode);
});

test("published retention without its owner sidecar is corruption during recovery and acquisition", async (t) => {
  const { journal, root, sessionId } = await createJournalCase(t, { retentionRecords: 1 });
  const { exit } = await startOwner(t, { root, sessionId, boundary: "after" });
  assert.deepEqual(await exit, [44, null]);
  const owners = path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentionOwners);
  const retentions = path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentions);
  await unlink(path.join(owners, "0.lock"));

  const corruption = (error) => {
    assert.equal(error.code, "SESSION_STORAGE_CORRUPT");
    assert.equal(error.cause.code, "ENOENT");
    return true;
  };
  await assert.rejects(PartitionJournal.open({ root, sessionId }), corruption);
  await assert.rejects(journal.snapshot(), corruption);
  await assert.rejects(
    withUnretainedJournal(root, () => assert.fail("Missing ownership must prevent removal")),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
  assert.deepEqual(await readdir(owners), []);
  assert.deepEqual(await readdir(retentions), ["0.json"]);
});

for (const boundary of ["before", "after"]) {
  test(
    `process death ${boundary} retention rename permits safe slot recovery`,
    { timeout: 15000 },
    async (t) => {
      const { root, sessionId } = await createJournalCase(t, { retentionRecords: 1 });
      const { exit } = await startOwner(t, { root, sessionId, boundary });
      assert.deepEqual(await exit, [44, null]);
      const lock = path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentionOwners, "0.lock");
      const inode = (await stat(lock)).ino;
      const recovered = await PartitionJournal.open({ root, sessionId });
      t.after(() => recovered.close());
      assert.deepEqual(await readdir(path.join(root, "retentions")), []);
      await recovered.usingSnapshot(() => {});
      assert.equal((await stat(lock)).ino, inode);
    },
  );
}

for (const retention of ["damaged", "absent"]) {
  test(
    `removal with corrupt CURRENT and ${retention} retention still protects a live process`,
    { timeout: 15000 },
    async (t) => {
      const { journal, root, sessionId } = await createJournalCase(t, { retentionRecords: 1 });
      await journal.close();
      const { child, exit } = await startOwner(t, { root, sessionId });
      const ready = await Promise.race([once(child, "message").then(([value]) => value), exit]);
      assert.deepEqual(ready, { sequence: 0 });
      await writeFile(path.join(root, "CURRENT"), "damaged head");
      const slot = path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentions, "0.json");
      if (retention === "damaged") await writeFile(slot, "damaged retention");
      else await unlink(slot);
      await assert.rejects(
        withUnretainedJournal(root, () => assert.fail("A live owner must prevent removal")),
        { code: "SESSION_MUTATION_BUSY" },
      );
      child.kill("SIGKILL");
      await exit;
      await withUnretainedJournal(root, () => rm(root, { recursive: true }));
      await assert.rejects(stat(root), { code: "ENOENT" });
    },
  );
}
