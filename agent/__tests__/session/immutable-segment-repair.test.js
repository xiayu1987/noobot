/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import {
  auditImmutableSession,
  auditImmutableSnapshot,
} from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  captureImmutableObjectRepairs,
  restoreImmutableObjects,
} from "../../src/session/session-artifact-session/immutable-object-repair.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-segment-repair-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  t.after(resetFsAdapter);
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "repair-segments",
    allowCreate: true,
    objectStore: ImmutableRecordStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      { collection: "messages", key: "m1", value: { content: "original message" } },
      { collection: "metadata", key: "session", value: { sessionId: store.sessionId } },
    ],
  });
  const head = await store.snapshot();
  const reference = head.root;
  const record = decodeImmutableRecordReference(reference);
  const file = store.objects.segments.segmentPath(record.segmentId);
  const original = await store.objects.read(reference);
  const headBytes = await readFile(store.headPath);
  const restore = (replacements) =>
    sessionMutationCoordinator.run(store.lockPath, () =>
      restoreImmutableObjects({
        sessionDir,
        replacements: captureImmutableObjectRepairs(replacements),
        objectStore: ImmutableRecordStore,
      }),
    );
  return { sessionDir, store, head, reference, record, file, original, headBytes, restore };
}

async function corrupt(file, record) {
  const handle = await open(file, "r+");
  try {
    await handle.write(Buffer.from([0xff]), 0, 1, record.offset);
  } finally {
    await handle.close();
  }
}

test("repair replaces one damaged record atomically and preserves every other byte in its shared segment", async (t) => {
  const { store, sessionDir, file, reference, record, original, headBytes, restore } =
    await fixture(t);
  const before = await readFile(file);
  await corrupt(file, record);
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: ImmutableRecordStore })).ok,
    false,
  );
  const repaired = await restore([{ reference, bytes: original }]);
  assert.deepEqual(repaired, [`segments/${path.basename(file)}`]);
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readFile(store.headPath), headBytes);
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: ImmutableRecordStore })).ok,
    true,
  );
  assert.deepEqual(await restore([{ reference, bytes: original }]), []);
});

test("missing shared segments require all retained records before the first write", async (t) => {
  const { store, sessionDir, head, file, reference, original, headBytes, restore } =
    await fixture(t);
  const retainedObjects = new Set();
  assert.equal((await auditImmutableSnapshot({ store, snapshot: head, retainedObjects })).ok, true);
  const replacements = await Promise.all(
    [...retainedObjects].map(async (reference) => ({
      reference,
      bytes: await store.objects.read(reference),
    })),
  );
  await rm(file);
  await assert.rejects(restore([{ reference, bytes: original }]), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.equal((await restore(replacements)).length, 1);
  assert.equal(
    (await auditImmutableSession({ sessionDir, objectStore: ImmutableRecordStore })).ok,
    true,
  );
  assert.deepEqual(await store.get(head, "messages", "m1"), { content: "original message" });
  assert.deepEqual(await readFile(store.headPath), headBytes);
});

test("invalid replacement bytes and unreferenced records leave the damaged segment untouched", async (t) => {
  const { store, sessionDir, file, reference, record, original, restore } = await fixture(t);
  await corrupt(file, record);
  const damaged = await readFile(file);
  await assert.rejects(restore([{ reference, bytes: Buffer.from("wrong") }]), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  const batch = store.objects.segments.createBatch();
  const bytes = Buffer.from("not committed");
  const unused = batch.stage(bytes);
  await batch.publish([unused]);
  await assert.rejects(
    restore([
      { reference, bytes: original },
      { reference: unused, bytes },
    ]),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(await readFile(file), damaged);
  assert.ok(
    (await readdir(path.join(sessionDir, "segments"))).every((name) => name.endsWith(".seg")),
  );
});

for (const stage of ["segments", "session"]) {
  test(`segment repair retries a failed ${stage} durability barrier without rewriting matching bytes`, async (t) => {
    const { store, sessionDir, file, reference, record, original, headBytes, restore } =
      await fixture(t);
    await corrupt(file, record);
    const failingDirectory = stage === "segments" ? path.dirname(file) : sessionDir;
    const failure = Object.assign(new Error(`failed ${stage} sync`), { code: "EIO" });
    let fail = true;
    let writes = 0;
    const synced = [];
    setFsAdapter({
      rename: async (source, target) => {
        if (target === file) writes++;
        return rename(source, target);
      },
      open: async (target, flags) => {
        const handle = await open(target, flags);
        return new Proxy(handle, {
          get(object, key) {
            if (key === "sync" && flags === "r")
              return async () => {
                if (fail && target === failingDirectory) throw failure;
                await object.sync();
                synced.push(target);
              };
            const value = Reflect.get(object, key, object);
            return typeof value === "function" ? value.bind(object) : value;
          },
        });
      },
    });
    const replacements = [{ reference, bytes: original }];
    await assert.rejects(restore(replacements), (error) => error === failure);
    await assert.rejects(restore(replacements), (error) => error === failure);
    fail = false;
    synced.length = 0;
    assert.deepEqual(await restore(replacements), []);
    assert.equal(writes, 1);
    assert.deepEqual(synced, [path.dirname(file), sessionDir]);
    assert.deepEqual(await readFile(store.headPath), headBytes);
  });
}
