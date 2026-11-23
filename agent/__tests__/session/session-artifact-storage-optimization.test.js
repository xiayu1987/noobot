/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { withSessionReadCache, memoizeSessionRead } from "../../src/session/session-read-cache.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import {
  readOptionalJsonWithStorage,
  writeJsonWithStorage,
} from "../../src/session/session-artifact-session/artifact-json-io.js";
import {
  beginArtifactPruning,
  pruneSessionArtifacts,
} from "../../src/session/session-artifact-session/artifact-pruning.js";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-files.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp } from "./session-artifact-store-v2.test-helpers.js";

const missing = (file) => assert.rejects(stat(file), { code: "ENOENT" });

test("read caches deduplicate concurrent and nested reads and isolate sessions", async () =>
  withTemp(async (root) => {
    const file = path.join(root, "session.json");
    let reads = 0;
    const read = () => memoizeSessionRead("test", file, async () => ++reads);
    await withSessionReadCache(root, async () => {
      assert.deepEqual(await Promise.all([read(), read()]), [1, 1]);
      assert.equal(await withSessionReadCache(root, read), 1);
      assert.equal(await withSessionReadCache(path.join(root, "other"), read), 2);
      assert.equal(await read(), 1);
    });
    assert.equal(await withSessionReadCache(root, read), 3);
    assert.equal(await read(), 4);
  }));

test("cached JSON reads return owned copies and writes invalidate all cached tiers", async () =>
  withTemp(async (root) => {
    const artifactPath = path.join(root, "session.json");
    await writeFile(artifactPath, JSON.stringify({ revision: 1 }));
    const options = { storageService, artifactPath };
    await withSessionReadCache(root, async () => {
      const first = await readOptionalJsonWithStorage(options);
      first.revision = 99;
      assert.deepEqual(await readOptionalJsonWithStorage(options), { revision: 1 });
      await assert.rejects(
        writeJsonWithStorage({
          ...options,
          payload: { revision: 2 },
          atomic: true,
          storageService: Object.assign(Object.create(storageService), {
            writeJsonAtomic: async () => {
              throw new Error("write failed");
            },
          }),
        }),
        /write failed/,
      );
      assert.deepEqual(await readOptionalJsonWithStorage(options), { revision: 1 });
      await writeJsonWithStorage({ ...options, payload: { revision: 2 }, atomic: true });
      assert.deepEqual(await readOptionalJsonWithStorage(options), { revision: 2 });
    });
  }));

test("transaction JSON snapshots isolate concurrent owners and preserve the exact source", async () =>
  withTemp(async (root) => {
    const artifactPath = path.join(root, "session.json");
    await writeFile(artifactPath, '{"nested":{"value":-0},"items":[1,2]}');
    const options = { storageService, artifactPath };
    const observed = await observeSessionStorageWork(() =>
      withSessionReadCache(root, async () => {
        const [first, second] = await Promise.all([
          readOptionalJsonWithStorage(options),
          readOptionalJsonWithStorage(options),
        ]);
        assert.notEqual(first.nested, second.nested);
        assert.ok(Object.is(first.nested.value, -0));
        assert.ok(Object.is(second.nested.value, -0));
        first.nested.value = 99;
        second.items.pop();
        const third = await readOptionalJsonWithStorage(options);
        assert.ok(Object.is(third.nested.value, -0));
        assert.deepEqual(third.items, [1, 2]);
      }),
    );
    assert.equal(observed.work.optionalJsonReads, 1);
    assert.equal(observed.work.manifestReadBytes, (await stat(artifactPath)).size);
    await writeFile(artifactPath, '{"nested":');
    await assert.rejects(readOptionalJsonWithStorage(options), {
      code: "PERSISTED_JSON_CORRUPTED",
    });
    assert.equal(
      await readOptionalJsonWithStorage({
        ...options,
        artifactPath: path.join(root, "missing.json"),
      }),
      null,
    );
  }));

test("transaction JSON copies also isolate injected storage without source observations", async () =>
  withTemp(async (root) => {
    const storage = Object.assign(Object.create(storageService), {
      readOptionalJson: async () => ({ nested: { value: -0 } }),
    });
    const options = { storageService: storage, artifactPath: path.join(root, "session.json") };
    await withSessionReadCache(root, async () => {
      const first = await readOptionalJsonWithStorage(options);
      first.nested.value = 99;
      assert.ok(Object.is((await readOptionalJsonWithStorage(options)).nested.value, -0));
    });
  }));

test("pruning scans once, deletes lost references without scans, and recovers after interrupted writes", async () =>
  withTemp(async (root) => {
    const files = buildSessionArtifactFileMap(root);
    await mkdir(files.turnsDir, { recursive: true });
    await mkdir(path.join(files.turnSnapshotsDir, "turn-1"), { recursive: true });
    await writeFile(files.session, "{}");
    const journal = path.join(files.turnsDir, "turn-1.jsonl");
    const orphan = path.join(files.turnsDir, "orphan.jsonl");
    const snapshot = path.join(files.turnSnapshotsDir, "turn-1", "checkpoint-1.json");
    const turnOrder = [
      {
        file: path.relative(root, journal).replaceAll("\\", "/"),
        summarySnapshots: [{ file: path.relative(root, snapshot).replaceAll("\\", "/") }],
      },
    ];
    for (const file of [journal, orphan, snapshot]) await writeFile(file, "{}");
    assert.equal(await beginArtifactPruning(files), true);
    await pruneSessionArtifacts({ files, turnOrder, fullScan: true });
    await missing(orphan);
    assert.equal(await readFile(snapshot, "utf8"), "{}");
    assert.equal(await beginArtifactPruning(files), false);
    const retained = await observeSessionStorageWork(() =>
      pruneSessionArtifacts({ files, previousManifest: { turnOrder }, turnOrder, fullScan: false }),
    );
    assert.equal(retained.work.pruneSnapshotVisits || 0, 0);
    assert.equal(await beginArtifactPruning(files), false);
    const delta = await observeSessionStorageWork(() =>
      pruneSessionArtifacts({
        files,
        previousManifest: { turnOrder },
        turnOrder: [],
        fullScan: false,
      }),
    );
    assert.equal(delta.work.pruneDirectoryScans || 0, 0);
    await missing(journal);
    await missing(snapshot);
    assert.equal(await beginArtifactPruning(files), false);
    await writeFile(orphan, "uncommitted");
    assert.equal(
      await beginArtifactPruning(files),
      true,
      "an interrupted write must force reconciliation",
    );
    await pruneSessionArtifacts({ files, turnOrder: [], fullScan: true });
    await missing(orphan);
    await writeFile(files.session, '{"external":true}');
    assert.equal(
      await beginArtifactPruning(files),
      true,
      "external manifest changes invalidate reconciliation",
    );
  }));
