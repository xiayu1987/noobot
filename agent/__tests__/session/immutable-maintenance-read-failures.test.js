/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, open, readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_READER_RETENTION as RETENTION,
  IMMUTABLE_CLEANUP_PLAN as PLAN,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableLocationRetirement } from "../../src/session/session-artifact-session/immutable-location-retirement.js";
import { ImmutableCleanupRetention } from "../../src/session/session-artifact-session/immutable-cleanup-retention.js";
import { publishImmutableCleanupRetention } from "../../src/session/session-artifact-session/immutable-cleanup-preparation.js";
import { prepareImmutableSegmentRepair } from "../../src/session/session-artifact-session/immutable-segment-repair.js";
import {
  acquireImmutableReaderRetention,
  inspectImmutableReaderRetention,
  recoverImmutableReaderRetention,
  readImmutableReaderRetentions,
} from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "maintenance-read-failure-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "reads", allowCreate: true });
  await store.commit({ expectedGeneration: 0, operationId: "seed", changes: [] });
  return { store, sessionDir };
}

function failHandle(file, stage) {
  const reading = Object.assign(new Error("injected read ENOENT"), { code: "ENOENT" });
  const closing = Object.assign(new Error("injected close ENOENT"), { code: "ENOENT" });
  let closes = 0;
  setFsAdapter({
    open: async (target, flags, ...args) => {
      const handle = await open(target, flags, ...args);
      if (target === file && flags === "r") {
        if (stage !== "close")
          handle.read = async () => {
            throw reading;
          };
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closes += 1;
          await close();
          if (stage !== "read") throw closing;
        };
      }
      return handle;
    },
  });
  return {
    check: (error) => {
      if (stage === "both") {
        assert.deepEqual(error.errors, [reading, closing]);
        assert.equal(error.cause, reading);
      } else assert.equal(error, stage === "read" ? reading : closing);
      assert.equal(closes, 1);
      return true;
    },
  };
}

for (const stage of ["read", "close", "both"]) {
  test(`cleanup ownership read failures never drop preparation roots (${stage})`, async (t) => {
    const { store, sessionDir } = await fixture(t);
    const head = await store.snapshot();
    const id = randomUUID();
    const directory = path.join(sessionDir, PLAN.directory, id);
    await mkdir(directory, { recursive: true });
    await publishImmutableCleanupRetention(directory, id, [head]);
    const file = path.join(directory, PLAN.preparation);
    const bytes = await readFile(file);
    const fault = failHandle(file, stage);
    await assert.rejects(readImmutableReaderRetentions(store, head), fault.check);
    resetFsAdapter();
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readImmutableReaderRetentions(store, head), [head]);
    assert.deepEqual(await store.snapshot(), head);
  });

  test(`cleanup checkpoint read failures never replace a protected set (${stage})`, async (t) => {
    const { sessionDir } = await fixture(t);
    const directory = path.join(sessionDir, "retention");
    const identity = "a".repeat(32);
    const retained = new ImmutableCleanupRetention(directory, { create: true });
    await retained.add(identity);
    await retained.flush();
    const bytes = await readFile(retained.file);
    for (const create of [false, true]) {
      const reopened = new ImmutableCleanupRetention(directory, { create });
      const fault = failHandle(retained.file, stage);
      await assert.rejects(reopened.add("b".repeat(32)), fault.check);
      resetFsAdapter();
      assert.equal(reopened.pending.size, 0);
      assert.equal(reopened.loaded, false);
      assert.deepEqual(await readFile(retained.file), bytes);
      assert.equal(await reopened.has(identity), true);
      assert.equal(reopened.size, 1);
    }
  });

  test(`offline object publication and repair preserve opened-file failures (${stage})`, async (t) => {
    const { sessionDir } = await fixture(t);
    const objects = new ImmutableObjectStore(sessionDir);
    const bytes = Buffer.from("original object");
    const reference = await objects.put(bytes);
    const file = objects.objectPath(reference);
    for (const operation of ["publish", "repair"]) {
      const fault = failHandle(file, stage);
      const request =
        operation === "publish"
          ? objects.put(bytes)
          : objects.restoreRecords(new Map([[reference, Buffer.from("replacement")]]));
      await assert.rejects(request, (error) =>
        fault.check(operation === "publish" ? error.cause : error),
      );
      resetFsAdapter();
      assert.deepEqual(await readFile(file), bytes);
    }
  });

  test(`opened head failures never provision an empty generation (${stage})`, async (t) => {
    const { store, sessionDir } = await fixture(t);
    const bytes = await readFile(store.headPath);

    const fresh = new ImmutableSessionStore({ sessionDir, sessionId: "reads", allowCreate: true });
    const fault = failHandle(store.headPath, stage);
    await assert.rejects(fresh.snapshot(), fault.check);
    resetFsAdapter();
    assert.deepEqual(await readFile(store.headPath), bytes);
    assert.equal((await fresh.snapshot()).generation, 1);
  });

  test(`reader recovery preserves retention after opened-file failure (${stage})`, async (t) => {
    const { store, sessionDir } = await fixture(t);
    const retention = await acquireImmutableReaderRetention(store, async () => {});
    const directory = path.join(sessionDir, RETENTION.directory);
    const [name] = await readdir(directory);
    const readerId = name.slice(0, -5);
    const inspected = await inspectImmutableReaderRetention(store, readerId);
    const file = path.join(directory, name);
    const bytes = await readFile(file);
    const fault = failHandle(file, stage);
    await assert.rejects(
      recoverImmutableReaderRetention(store, {
        readerId,
        expectedRecordDigest: inspected.recordDigest,
      }),
      fault.check,
    );
    resetFsAdapter();
    assert.deepEqual(await readFile(file), bytes);
    await retention.release();
  });

  test(`retirement load cannot reset or discard a failed proof read (${stage})`, async (t) => {
    const { store } = await fixture(t);
    const head = await store.snapshot();
    const proof = new ImmutableLocationRetirement(store, {
      operationId: "proof",
      expectedGeneration: head.generation,
      records: [
        {
          identity: head.commit,
          sourceLocation: await store.objects.locations.get(head.locationRoot, head.commit),
        },
      ],
    });
    const state = await proof.load(head);
    await proof.save(state);
    const bytes = await readFile(proof.file);
    for (const create of [true, false]) {
      const fault = failHandle(proof.file, stage);
      await assert.rejects(proof.load(head, create), fault.check);
      resetFsAdapter();
      assert.deepEqual(await readFile(proof.file), bytes);
    }
    assert.deepEqual(await proof.load(head), state);
  });

  test(`repair never substitutes an empty segment for an opened-file failure (${stage})`, async (t) => {
    const { store } = await fixture(t);
    const bytes = await readFile(store.headPath);
    const fault = failHandle(store.headPath, stage);
    await assert.rejects(
      prepareImmutableSegmentRepair(
        {
          segmentPath: () => store.headPath,
        },
        "source",
        [],
      ),
      fault.check,
    );
    resetFsAdapter();
    assert.deepEqual(await readFile(store.headPath), bytes);
  });
}
