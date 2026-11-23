/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, rm } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { withUnretainedJournal } from "../../src/session/partition-storage/journal-snapshots.js";
import { createJournalCase, journalRequest } from "../helpers/partition-journal-cases.js";

const origin = { partition: 0, offset: 0, sequence: 0 };

test("snapshot acquisition makes CURRENT durable before publishing a retained head", async (t) => {
  const { journal, root } = await createJournalCase(
    t,
    { retentionRecords: 1 },
    { autoClose: false },
  );
  await journal.usingSnapshot(() => {});
  const adapter = getFsAdapter();
  const current = path.join(root, "CURRENT");
  const slot = path.join(root, "retentions", "0.json");
  const events = [];
  let renamedCurrent = false;
  let failSync = false;
  const syncFailure = Object.assign(new Error("Root directory sync interrupted"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    async rename(source, target, ...args) {
      await adapter.rename(source, target, ...args);
      if (String(target) === current) {
        renamedCurrent = true;
        throw Object.assign(new Error("CURRENT rename was not synced"), { code: "EIO" });
      }
      if (String(target) === slot) events.push("slot rename");
    },
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (String(file) === root) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (failSync) throw syncFailure;
          await sync();
          if (renamedCurrent) events.push("root sync");
        };
      }
      return handle;
    },
  });
  try {
    await assert.rejects(journal.append(journalRequest(journal, 1, { value: 1 })), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
    assert.deepEqual(events, []);
    failSync = true;
    await journal.withPublicationSnapshot(async (snapshot) => {
      assert.equal(snapshot.sequence, 1);
      assert.equal((await journal.readPage({ snapshot, cursor: origin })).done, true);
    });
    await assert.rejects(
      journal.usingSnapshot(() => assert.fail("Reader ran before durable retention")),
      (error) => error === syncFailure,
    );
    assert.deepEqual(await readdir(path.dirname(slot)), []);
    assert.deepEqual(events, []);
    failSync = false;
    await journal.usingSnapshot((snapshot) => {
      assert.equal(snapshot.sequence, 1);
      assert.deepEqual(events, ["root sync", "slot rename"]);
    });
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    setFsAdapter(adapter);
  }
});

test("publication snapshot protects active reads from removal without retaining a slot", async (t) => {
  const { journal, root } = await createJournalCase(t);
  await journal.append(journalRequest(journal, 1, { value: 1 }));
  const entered = Promise.withResolvers();
  const read = Promise.withResolvers();
  let snapshot;
  let removed = false;
  const reading = journal.withPublicationSnapshot((current) => {
    snapshot = current;
    entered.resolve();
    return journal.withSnapshot(current, async () => {
      await read.promise;
      assert.equal(removed, false);
      assert.equal((await journal.readPage({ snapshot: current, cursor: origin })).done, true);
    });
  });
  await entered.promise;
  const removal = withUnretainedJournal(root, async () => {
    removed = true;
    await rm(root, { recursive: true });
  });
  read.resolve();
  await Promise.all([reading, removal]);
  assert.equal(removed, true);
  await assert.rejects(journal.readPage({ snapshot, cursor: origin }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
});

async function failPublication(journal, root, boundary, operation) {
  const adapter = getFsAdapter();
  let injected = false;
  setFsAdapter({
    ...adapter,
    async rename(source, target, ...args) {
      if (!injected && String(target) === path.join(root, "retentions", "0.json")) {
        injected = true;
        if (boundary === "after") await adapter.rename(source, target, ...args);
        throw Object.assign(new Error("Snapshot publication interrupted"), { code: "EIO" });
      }
      return adapter.rename(source, target, ...args);
    },
  });
  try {
    return await operation(journal);
  } finally {
    setFsAdapter(adapter);
    assert.equal(injected, true);
  }
}

for (const boundary of ["before", "after"]) {
  test(`failed snapshot publication ${boundary} rename exposes only a releasable capability`, async (t) => {
    const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
    let failed;
    await failPublication(journal, root, boundary, async () => {
      await assert.rejects(journal.snapshot(), (error) => {
        assert.equal(error.code, "SESSION_SNAPSHOT_UNCERTAIN");
        assert.equal(error.cause.code, "EIO");
        failed = error.snapshot;
        return true;
      });
    });
    await assert.rejects(journal.readPage({ snapshot: failed, cursor: origin }), {
      code: "SESSION_SNAPSHOT_RELEASED",
    });
    await journal.releaseSnapshot(failed);
    assert.deepEqual(await readdir(path.join(root, "retentions")), []);
    await journal.usingSnapshot(async (snapshot) => {
      assert.equal((await journal.readPage({ snapshot, cursor: origin })).done, true);
    });
    assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  });

  test(`scoped acquisition releases uncertain publication ${boundary} rename without running the reader`, async (t) => {
    const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
    let called = false;
    await failPublication(journal, root, boundary, async () => {
      await assert.rejects(
        journal.usingSnapshot(() => {
          called = true;
        }),
        {
          code: "SESSION_SNAPSHOT_UNCERTAIN",
        },
      );
    });
    assert.equal(called, false);
    assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  });
}

test("writer lock cleanup failure preserves a closed capability for explicit release", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  const adapter = getFsAdapter();
  let failed;
  let injected = false;
  setFsAdapter({
    ...adapter,
    async open(file, ...args) {
      const handle = await adapter.open(file, ...args);
      if (String(file) === journal.lockPath) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          injected = true;
          throw Object.assign(new Error("Writer lock close interrupted"), { code: "EIO" });
        };
      }
      return handle;
    },
  });
  try {
    await assert.rejects(journal.snapshot(), (error) => {
      assert.equal(error.code, "SESSION_SNAPSHOT_UNCERTAIN");
      assert.equal(error.cause.code, "EIO");
      failed = error.snapshot;
      return true;
    });
  } finally {
    setFsAdapter(adapter);
  }
  assert.equal(injected, true);
  await assert.rejects(journal.readPage({ snapshot: failed, cursor: origin }), {
    code: "SESSION_SNAPSHOT_RELEASED",
  });
  await journal.releaseSnapshot(failed);
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);
});

test("releasing an unpublished acquisition preserves a subsequently reused slot", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  let failed;
  await failPublication(journal, root, "before", async () => {
    await assert.rejects(journal.snapshot(), (error) => {
      failed = error.snapshot;
      return error.code === "SESSION_SNAPSHOT_UNCERTAIN";
    });
  });
  const next = await journal.snapshot();
  const retained = await readFile(path.join(root, "retentions", "0.json"));
  await journal.releaseSnapshot(failed);
  assert.deepEqual(await readFile(path.join(root, "retentions", "0.json")), retained);
  assert.equal((await journal.readPage({ snapshot: next, cursor: origin })).done, true);
  await journal.releaseSnapshot(next);
});

test("scoped snapshots release on callback failure and preserve both operation and cleanup errors", async (t) => {
  const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
  const failure = new Error("Reader failed");
  await assert.rejects(
    journal.usingSnapshot(() => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  const adapter = getFsAdapter();
  let snapshot;
  const cleanupFailure = Object.assign(new Error("Release failed"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    async rm(file, ...args) {
      if (String(file) === path.join(root, "retentions", "0.json")) throw cleanupFailure;
      return adapter.rm(file, ...args);
    },
  });
  try {
    await assert.rejects(
      journal.usingSnapshot(() => {
        throw failure;
      }),
      (error) => {
        assert.equal(error.code, "SESSION_SNAPSHOT_RELEASE_UNCERTAIN");
        assert.ok(error.cause instanceof AggregateError);
        assert.deepEqual(error.cause.errors, [failure, cleanupFailure]);
        snapshot = error.snapshot;
        return true;
      },
    );
  } finally {
    setFsAdapter(adapter);
  }
  await journal.releaseSnapshot(snapshot);
  assert.deepEqual(await readdir(path.join(root, "retentions")), []);
});

for (const boundary of ["delete", "sync", "lock-cleanup"]) {
  test(`scoped cleanup ${boundary} failure returns the capability without callback cooperation`, async (t) => {
    const { journal, root } = await createJournalCase(t, { retentionRecords: 1 });
    const adapter = getFsAdapter();
    const failure = Object.freeze(Object.assign(new Error("Cleanup interrupted"), { code: "EIO" }));
    let injected = false;
    let readingFinished = false;
    let snapshot;
    setFsAdapter({
      ...adapter,
      async rm(file, ...args) {
        const target = String(file);
        if (
          readingFinished &&
          !injected &&
          boundary === "delete" &&
          target.endsWith("retentions/0.json")
        ) {
          injected = true;
          throw failure;
        }
        return adapter.rm(file, ...args);
      },
      async open(file, ...args) {
        const handle = await adapter.open(file, ...args);
        if (readingFinished && boundary === "lock-cleanup" && String(file) === journal.lockPath) {
          const close = handle.close.bind(handle);
          handle.close = async () => {
            await close();
            injected = true;
            throw failure;
          };
        }
        if (String(file) === path.join(root, "retentions")) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            if (readingFinished && !injected && boundary === "sync") {
              injected = true;
              throw failure;
            }
            return sync();
          };
        }
        return handle;
      },
    });
    try {
      await assert.rejects(
        journal.usingSnapshot(async (retained) => {
          assert.equal((await journal.readPage({ snapshot: retained, cursor: origin })).done, true);
          readingFinished = true;
        }),
        (error) => {
          assert.equal(error.code, "SESSION_SNAPSHOT_RELEASE_UNCERTAIN");
          assert.equal(error.cause, failure);
          snapshot = error.snapshot;
          return true;
        },
      );
    } finally {
      setFsAdapter(adapter);
    }
    assert.equal(injected, true);
    await assert.rejects(journal.readPage({ snapshot, cursor: origin }), {
      code: "SESSION_SNAPSHOT_RELEASED",
    });
    await journal.releaseSnapshot(snapshot);
    assert.deepEqual(await readdir(path.join(root, "retentions")), []);
    await journal.usingSnapshot(() => {});
    assert.deepEqual(await readdir(path.join(root, "retentions")), []);
  });
}
