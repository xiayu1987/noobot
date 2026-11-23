/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const HEAD_BYTES = LENGTH_THRESHOLDS.immutableStorage.headBytes;

async function fixture(context, sessionId = "bounded") {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-head-boundary-"));
  context.after(() => rm(sessionDir, { recursive: true, force: true }));
  context.after(resetFsAdapter);
  const store = new ImmutableSessionStore({ sessionDir, sessionId, allowCreate: true });
  await store.commit({ expectedGeneration: 0, operationId: "seed", changes: [] });
  return store;
}

for (const entry of ["open", "snapshot"]) {
  test(`${entry} rejects invalid UTF-8 even when replacement decoding preserves the head checksum`, async (context) => {
    const store = await fixture(context, "bounded-\ufffd");
    const expected = await store.snapshot();
    const bytes = await readFile(store.headPath);
    const offset = bytes.indexOf(Buffer.from("\ufffd"));
    assert.ok(offset >= 0);
    await writeFile(
      store.headPath,
      Buffer.concat([bytes.subarray(0, offset), Buffer.from([0xff]), bytes.subarray(offset + 3)]),
    );
    await assert.rejects(
      entry === "open"
        ? ImmutableSessionStore.open({ sessionDir: store.sessionDir })
        : store.snapshot(),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    await writeFile(store.headPath, bytes);
    assert.deepEqual(await store.snapshot(), expected);
  });

  test(`${entry} rejects an oversized head after at most the protocol limit plus one byte`, async (context) => {
    const store = await fixture(context);
    await writeFile(store.headPath, Buffer.alloc(HEAD_BYTES * 32, 32));
    const { work } = await observeSessionStorageWork(async () => {
      await assert.rejects(
        entry === "open"
          ? ImmutableSessionStore.open({ sessionDir: store.sessionDir })
          : store.snapshot(),
        { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
      );
    });
    assert.equal(work.immutableHeadReadBytes, HEAD_BYTES + 1);
  });
}

test("head reads handle short reads at the exact limit and close each descriptor", async (context) => {
  const store = await fixture(context);
  const original = await readFile(store.headPath);
  const expected = await store.snapshot();
  await writeFile(
    store.headPath,
    Buffer.concat([original, Buffer.alloc(HEAD_BYTES - original.length, 32)]),
  );
  let closes = 0;
  let total = 0;
  setFsAdapter({
    readFile: async (file, ...options) => {
      assert.notEqual(file, store.headPath, "head must use bounded descriptor reads");
      return readFile(file, ...options);
    },
    open: async (file, flags) => {
      const handle = await open(file, flags);
      assert.equal(file, store.headPath);
      return {
        read: async (buffer, offset, length, position) => {
          const result = await handle.read(buffer, offset, Math.min(length, 37), position);
          total += result.bytesRead;
          return result;
        },
        close: async () => {
          closes += 1;
          await handle.close();
        },
      };
    },
  });
  assert.deepEqual(await store.snapshot(), expected);
  const discovered = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  assert.equal(discovered.sessionId, store.sessionId);
  assert.equal(total, HEAD_BYTES * 2);
  assert.equal(closes, 2);
});

test("head read I/O failure propagates and closes its descriptor", async (context) => {
  const store = await fixture(context);
  const failure = Object.assign(new Error("injected head read failure"), { code: "EIO" });
  let closes = 0;
  setFsAdapter({
    open: async () => ({
      read: async () => {
        throw failure;
      },
      close: async () => {
        closes += 1;
      },
    }),
  });
  await assert.rejects(store.snapshot(), (error) => error === failure);
  assert.equal(closes, 1);
});
