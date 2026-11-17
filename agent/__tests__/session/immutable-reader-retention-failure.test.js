/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_READER_RETENTION as RETENTION } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "reader-retention-failure-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "retention",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: "retention" } }],
  });
  return { store, directory: path.join(sessionDir, RETENTION.directory) };
}

function errorLeaves(error) {
  return error instanceof AggregateError ? error.errors.flatMap(errorLeaves) : [error];
}

for (const rollback of ["none", "remove", "sync", "both"]) {
  test(`reader acquisition preserves publication and rollback failures (${rollback})`, async (t) => {
    const { store, directory } = await fixture(t);
    const head = await store.snapshot();
    const publication = new Error("reader publication sync failed");
    const removal = new Error("reader rollback removal failed");
    const synchronization = new Error("reader rollback sync failed");
    const removeFails = rollback === "remove" || rollback === "both";
    const syncFails = rollback === "sync" || rollback === "both";
    let publishedFile;
    let syncs = 0;
    setFsAdapter({
      rename: async (source, target, ...args) => {
        const result = await rename(source, target, ...args);
        if (path.dirname(target) === directory) publishedFile = target;
        return result;
      },
      rm: async (file, ...args) => {
        if (file === publishedFile && removeFails) throw removal;
        return rm(file, ...args);
      },
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (publishedFile && file === directory && flags === "r") {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            if (++syncs === 1) throw publication;
            if (syncFails) throw synchronization;
            return sync();
          };
        }
        return handle;
      },
    });
    const expected = [publication];
    if (removeFails) expected.push(removal);
    if (syncFails) expected.push(synchronization);
    await assert.rejects(
      acquireImmutableReaderRetention(store, async () => {}),
      (error) => {
        assert.deepEqual(errorLeaves(error), expected);
        if (rollback === "none") assert.equal(error, publication);
        else assert.equal(error.cause, publication);
        return true;
      },
    );
    assert.equal(syncs, 2);
    resetFsAdapter();
    assert.deepEqual(await store.snapshot(), head);
    assert.deepEqual(await readdir(directory), removeFails ? [path.basename(publishedFile)] : []);
  });
}

for (const failure of ["remove", "sync", "both"]) {
  test(`reader release attempts sync despite removal failure and supports explicit retry (${failure})`, async (t) => {
    const { store, directory } = await fixture(t);
    const retention = await acquireImmutableReaderRetention(store, async () => {});
    const removal = new Error("reader release removal failed");
    const synchronization = new Error("reader release sync failed");
    const removeFails = failure === "remove" || failure === "both";
    const syncFails = failure === "sync" || failure === "both";
    let syncs = 0;
    setFsAdapter({
      rm: async (file, ...args) => {
        if (path.dirname(file) === directory && removeFails) throw removal;
        return rm(file, ...args);
      },
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (file === directory && flags === "r") {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            syncs += 1;
            if (syncFails) throw synchronization;
            return sync();
          };
        }
        return handle;
      },
    });
    const expected = [];
    if (removeFails) expected.push(removal);
    if (syncFails) expected.push(synchronization);
    await assert.rejects(retention.release(), (error) => {
      assert.deepEqual(errorLeaves(error), expected);
      if (expected.length === 1) assert.equal(error, expected[0]);
      else assert.equal(error.cause, removal);
      return true;
    });
    assert.equal(syncs, 1);
    resetFsAdapter();
    assert.equal((await readdir(directory)).length, removeFails ? 1 : 0);
    await retention.release();
    assert.deepEqual(await readdir(directory), []);
    await retention.release();
  });
}
