/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, opendir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupRetention,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  immutablePublicationTarget,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  requireImmutableSegmentId,
  immutableSegmentFileId,
} from "@noobot/session-protocol/immutable-segment";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import { writeDurableReplacement, syncStorageDirectory } from "./immutable-storage-io.js";
import { ImmutableRecordStore } from "./immutable-record-store.js";
import { ImmutableRadixIndex } from "./immutable-radix-index.js";

export class ImmutableCleanupRetention {
  constructor(directory, { create = false } = {}) {
    if (typeof directory !== "string" || !directory)
      throw new TypeError("Cleanup retention requires an owned scratch directory");
    this.pages = new ImmutableRecordStore(directory);
    this.index = new ImmutableRadixIndex(this.pages);
    this.root = null;
    this.file = path.join(directory, PLAN.retentionState);
    this.loaded = false;
    this.allowCreate = create;
    this.segmentTail = null;
    this.pending = new Set();
    this.segments = new Set();
    this.size = 0;
    this.mark = null;
  }

  async add(segmentId) {
    requireImmutableSegmentId(segmentId);
    await this.load();
    if (this.pending.size === PLAN.chunkEntries) await this.flush();
    this.pending.add(segmentId);
    if (this.pending.size === PLAN.chunkEntries) await this.flush();
  }

  async load() {
    if (this.loaded) return;
    let handle;
    try {
      handle = await fsOpen(this.file, "r");
    } catch (error) {
      if (error.code !== "ENOENT" || !this.allowCreate) throw error;
    }
    const bytes =
      handle === undefined ? undefined : await readHandlePrefix(handle, PLAN.recordBytes + 1);
    const state =
      bytes === undefined
        ? { format: PLAN.retentionFormat, root: null, segmentTail: null, size: 0, mark: null }
        : requireImmutableCleanupRetention(decodeImmutableCleanupBytes(bytes));
    await this.inventoryCapacity();
    await this.pages.validateSnapshot(state);
    if (bytes === undefined) {
      await mkdir(path.dirname(this.file), { recursive: true });
      await syncStorageDirectory(path.dirname(path.dirname(this.file)));
      await writeDurableReplacement(this.file, encodeImmutableCleanupRecord(state));
    } else {
      await syncStorageDirectory(path.dirname(this.file));
    }
    this.allowCreate = false;
    this.root = state.root;
    this.segmentTail = state.segmentTail;
    this.size = state.size;
    this.mark = state.mark;
    this.loaded = true;
  }

  async inventoryCapacity() {
    let entries;
    try {
      entries = await opendir(this.pages.segments.directory);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let scanned = 0;
    for await (const entry of entries) {
      const id = immutableSegmentFileId(immutablePublicationTarget(entry.name) ?? entry.name);
      if (!entry.isFile() || id === null)
        throw immutableStorageError("Invalid cleanup retention scratch entry");
      this.segments.add(id);
      if (++scanned > PLAN.retentionSegments) this.capacityExceeded();
    }
  }

  capacityExceeded() {
    throw Object.assign(new Error("Cleanup retention temporary segment capacity exceeded"), {
      code: "SESSION_MAINTENANCE_CAPACITY_EXCEEDED",
    });
  }

  requireCapacity() {
    for (const segment of this.pages.batch().records.segments) this.segments.add(segment.id);
    if (this.segments.size > PLAN.retentionSegments) this.capacityExceeded();
  }

  async flush() {
    await this.load();
    return this.checkpoint(this.mark);
  }

  async checkpoint(mark) {
    await this.load();
    if (!this.pending.size && mark === this.mark) return;
    try {
      await this.flushPending(mark);
    } catch (error) {
      this.loaded = false;
      throw error;
    }
  }

  async flushPending(mark) {
    return this.pages.withDurabilityBatch(async () => {
      this.pages.beginCommit({ segmentTail: this.segmentTail });
      const existing = await this.index.getMany(this.root, [...this.pending]);
      const additions = [...this.pending].filter((segmentId) => existing.get(segmentId) === null);
      if (!additions.length && mark === this.mark) {
        this.pending.clear();
        return;
      }
      let root = this.root;
      let segmentTail = this.segmentTail;
      if (additions.length) {
        const marker = await this.pages.putValue(true);
        root = await this.index.setMany(
          root,
          additions.map((segmentId) => [segmentId, marker]),
        );
        this.requireCapacity();
        await this.pages.publishReachable([root]);
        segmentTail = this.pages.publicationHeadFields().segmentTail;
      }
      const state = requireImmutableCleanupRetention({
        format: PLAN.retentionFormat,
        root,
        segmentTail,
        size: this.size + additions.length,
        mark,
      });
      await writeDurableReplacement(this.file, encodeImmutableCleanupRecord(state));
      this.allowCreate = false;
      this.segmentTail = state.segmentTail;
      this.root = state.root;
      this.size = state.size;
      this.mark = state.mark;
      this.pending.clear();
    });
  }

  async has(segmentId) {
    return (await this.hasMany([segmentId])).get(segmentId);
  }

  async hasMany(segmentIds) {
    if (!Array.isArray(segmentIds) || segmentIds.length > PLAN.chunkEntries)
      throw new TypeError("Cleanup retention lookup exceeds its batch budget");
    for (const segmentId of segmentIds) requireImmutableSegmentId(segmentId);
    if (!segmentIds.length) return new Map();
    await this.load();
    if (this.pending.size) throw new Error("Cleanup retention must be flushed before filtering");
    return this.pages.withReadScope(async () => {
      const entries = await this.index.getMany(this.root, segmentIds);
      return new Map([...entries].map(([segmentId, reference]) => [segmentId, reference !== null]));
    });
  }
}
