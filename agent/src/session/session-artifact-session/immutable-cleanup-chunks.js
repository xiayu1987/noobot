/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readFilePrefix, readHandlePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  encodeImmutableCleanupRecord,
  requireImmutableCleanupChunk,
  requireImmutableCleanupSessionFormat,
  decodeImmutableCleanupBytes,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_CLEANUP_CAPACITY as CAPACITY,
  requireImmutableCleanupCapacity,
} from "@noobot/session-protocol/immutable-cleanup-capacity";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import {
  contentDigest,
  writeDurableReplacement,
  syncStorageDirectory,
  withStorageCleanup,
} from "./immutable-storage-io.js";

export class ImmutableCleanupChunkWriter {
  constructor(directory, format) {
    this.directory = directory;
    this.format = requireImmutableCleanupSessionFormat(format);
    this.capacityFile = path.join(directory, CAPACITY.file);
  }

  async initialize() {
    const handle = await fsOpen(this.capacityFile, "wx");
    await withStorageCleanup(
      async () => {
        await handle.writeFile(
          encodeImmutableCleanupRecord({
            format: CAPACITY.format,
            pages: 0,
            reserved: null,
          }),
        );
        await handle.sync();
      },
      () => handle.close(),
    );
    await syncStorageDirectory(this.directory);
  }

  async exists(digest) {
    let handle;
    try {
      handle = await fsOpen(path.join(this.directory, `${digest}.json`), "r");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return false;
    }
    const bytes = await readHandlePrefix(handle, PLAN.recordBytes + 1);
    if (contentDigest(bytes) !== digest)
      throw immutableStorageError("Cleanup page identity mismatch");
    requireImmutableCleanupChunk(decodeImmutableCleanupBytes(bytes), this.format);
    await syncStorageDirectory(this.directory);
    return true;
  }

  async reserve(digest) {
    const state = requireImmutableCleanupCapacity(
      decodeImmutableCleanupBytes(
        await readFilePrefix(this.capacityFile, PLAN.recordBytes + 1, fsOpen),
      ),
    );
    if (await this.exists(digest)) return true;
    if (state.reserved !== digest) {
      if (state.pages >= PLAN.chunkPages)
        throw Object.assign(new Error("Cleanup inventory and candidate page capacity exceeded"), {
          code: "SESSION_MAINTENANCE_CAPACITY_EXCEEDED",
        });
      state.pages += 1;
      state.reserved = digest;
    }
    await writeDurableReplacement(this.capacityFile, encodeImmutableCleanupRecord(state));
    return false;
  }

  async write(files, signal, chain = { firstChunk: null, candidates: 0 }) {
    let { firstChunk, candidates } = chain;
    let pending = [];
    const flush = async () => {
      if (!pending.length) return;
      signal?.throwIfAborted();
      const bytes = encodeImmutableCleanupRecord(
        requireImmutableCleanupChunk({ previous: firstChunk, files: pending }, this.format),
      );
      const digest = contentDigest(bytes);
      const exists = await this.reserve(digest);
      signal?.throwIfAborted();
      if (!exists)
        await writeDurableReplacement(path.join(this.directory, `${digest}.json`), bytes);
      firstChunk = digest;
      pending = [];
    };
    for await (const file of files) {
      signal?.throwIfAborted();
      pending.push(file);
      candidates += 1;
      if (pending.length === PLAN.chunkEntries) await flush();
    }
    await flush();
    return { firstChunk, candidates };
  }
}
