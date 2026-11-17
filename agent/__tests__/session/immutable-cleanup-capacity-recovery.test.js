/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, rename, open, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  IMMUTABLE_CURRENT_SESSION_FORMAT as format,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  requireImmutableCleanupCapture,
} from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_CLEANUP_CAPACITY as CAPACITY } from "@noobot/session-protocol/immutable-cleanup-capacity";
import { IMMUTABLE_CLEANUP_FILTER as FILTER } from "@noobot/session-protocol/immutable-cleanup-filter";
import { ImmutableCleanupChunkWriter } from "../../src/session/session-artifact-session/immutable-cleanup-chunks.js";
import {
  initializeImmutableCleanupFiltering,
  advanceImmutableCleanupFiltering,
} from "../../src/session/session-artifact-session/immutable-cleanup-filter.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { writeDurableReplacement } from "../../src/session/session-artifact-session/immutable-storage-io.js";

const exec = promisify(execFile);
const retention = { hasMany: async (ids) => new Map(ids.map((id) => [id, false])) };

async function readRecord(directory, file) {
  return decodeImmutableCleanupBytes(await readFile(path.join(directory, file)));
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "cleanup-capacity-recovery-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(directory, { recursive: true, force: true });
  });
  const writer = new ImmutableCleanupChunkWriter(directory, format);
  await writer.initialize();
  const files = Array.from(
    { length: PLAN.chunkEntries * 2 + 1 },
    (_, i) => `segments/${i.toString(16).padStart(32, "0")}.seg`,
  );
  const inventory = await writer.write(files);
  const id = randomUUID();
  const capture = requireImmutableCleanupCapture(
    {
      format: PLAN.captureFormat,
      id,
      dryRun: false,
      ready: true,
      ...inventory,
      pages: Math.ceil(files.length / PLAN.chunkEntries),
    },
    id,
  );
  await initializeImmutableCleanupFiltering({ directory, capture, format });
  return { directory, writer, capture, head: { format }, retention, maxEntries: PLAN.chunkEntries };
}

for (const boundary of ["before-rename", "after-rename"]) {
  test(`filter checkpoint failure ${boundary} preserves capacity across process recovery`, async (t) => {
    const options = await fixture(t);
    const { directory } = options;
    const budget = await readRecord(directory, CAPACITY.file);
    await writeDurableReplacement(
      path.join(directory, CAPACITY.file),
      encodeImmutableCleanupRecord({
        ...budget,
        pages: PLAN.chunkPages - 1,
      }),
    );
    const failure = new Error("filter checkpoint publication failed");
    let published = false;
    setFsAdapter({
      rename: async (source, target, ...args) => {
        if (path.basename(target) !== FILTER.file) return rename(source, target, ...args);
        if (boundary === "before-rename") throw failure;
        const result = await rename(source, target, ...args);
        published = true;
        return result;
      },
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (published && file === directory && flags === "r")
          handle.sync = async () => {
            throw failure;
          };
        return handle;
      },
    });
    await assert.rejects(advanceImmutableCleanupFiltering(options), (error) => error === failure);
    resetFsAdapter();
    assert.equal((await readRecord(directory, CAPACITY.file)).pages, PLAN.chunkPages);
    const state = await readRecord(directory, FILTER.file);
    assert.equal(state.progress.processed, boundary === "before-rename" ? 0 : PLAN.chunkEntries);
    const module = new URL(
      "../../src/session/session-artifact-session/immutable-cleanup-filter.js",
      import.meta.url,
    ).href;
    const childOptions = { ...options, retention: undefined, writer: undefined };
    const { stdout } = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { advanceImmutableCleanupFiltering } from ${JSON.stringify(module)};
      const options = JSON.parse(process.argv[1]);
      options.retention = { hasMany: async ids => new Map(ids.map(id => [id, false])) };
      try { console.log(JSON.stringify(await advanceImmutableCleanupFiltering(options))); }
      catch (error) { console.log(JSON.stringify({ code: error.code })); }
    `,
        JSON.stringify(childOptions),
      ],
      { timeout: 15000 },
    );
    const recovered = JSON.parse(stdout);
    if (boundary === "before-rename") {
      assert.equal(recovered.processed, PLAN.chunkEntries);
      assert.equal(recovered.complete, false);
    } else assert.equal(recovered.code, "SESSION_MAINTENANCE_CAPACITY_EXCEEDED");
    const checkpoint = await readFile(path.join(directory, FILTER.file));
    await assert.rejects(advanceImmutableCleanupFiltering(options), {
      code: "SESSION_MAINTENANCE_CAPACITY_EXCEEDED",
    });
    assert.deepEqual(await readFile(path.join(directory, FILTER.file)), checkpoint);
    assert.equal((await readRecord(directory, CAPACITY.file)).pages, PLAN.chunkPages);
  });
}

test("capacity initialization cannot reset an existing plan reservation", async (t) => {
  const { directory, writer } = await fixture(t);
  const before = await readFile(path.join(directory, CAPACITY.file));
  await assert.rejects(writer.initialize(), { code: "EEXIST" });
  assert.deepEqual(await readFile(path.join(directory, CAPACITY.file)), before);
});

test("missing or corrupt capacity never recreates an empty budget", async (t) => {
  const { directory, writer } = await fixture(t);
  await unlink(path.join(directory, CAPACITY.file));
  await assert.rejects(writer.write(["segments/ffffffffffffffffffffffffffffffff.seg"]), {
    code: "ENOENT",
  });
  await writeFile(path.join(directory, CAPACITY.file), "corrupt");
  await assert.rejects(writer.write(["segments/ffffffffffffffffffffffffffffffff.seg"]), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("reusing a corrupt content-addressed page fails without overwriting it", async (t) => {
  const { directory, writer, capture } = await fixture(t);
  const file = path.join(directory, `${capture.firstChunk}.json`);
  const chunk = await readRecord(directory, `${capture.firstChunk}.json`);
  await writeFile(file, "damaged");
  await assert.rejects(
    writer.write(chunk.files, undefined, { firstChunk: chunk.previous, candidates: 0 }),
    {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    },
  );
  assert.equal(await readFile(file, "utf8"), "damaged");
});
