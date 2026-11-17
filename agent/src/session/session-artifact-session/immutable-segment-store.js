/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { fsMkdir, fsOpen } from "../../shared/storage/fs-adapter.js";
import {
  IMMUTABLE_SEGMENT,
  decodeImmutableRecordReference,
  encodeImmutableRecordReference,
  immutableSegmentFileName,
  requireImmutableSegmentTail,
} from "@noobot/session-protocol/immutable-segment";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_TRANSACTION_BUDGET,
  IMMUTABLE_VALUE_READ_BATCH_RECORDS,
} from "@noobot/session-protocol/immutable-storage-graph";
import { runStorageBatch } from "./storage-batch-results.js";
import {
  contentDigest,
  publishSyncedFile,
  syncStorageDirectory,
  withStorageCleanup,
} from "./immutable-storage-io.js";
import { recordStorageWork } from "./storage-transaction.js";

const MAGIC = Buffer.from(IMMUTABLE_SEGMENT.magic);

async function readRange(handle, offset, length) {
  const bytes = Buffer.alloc(length);
  let cursor = 0;
  while (cursor < length) {
    const { bytesRead } = await handle.read(bytes, cursor, length - cursor, offset + cursor);
    if (!bytesRead) throw immutableStorageError("Truncated immutable segment record");
    cursor += bytesRead;
  }
  return bytes;
}

async function writeRange(handle, bytes, position) {
  let cursor = 0;
  while (cursor < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      cursor,
      bytes.length - cursor,
      position + cursor,
    );
    if (!bytesWritten) throw immutableStorageError("Immutable segment write made no progress");
    cursor += bytesWritten;
  }
}

async function writeRecords(handle, records) {
  const ordered = [...records].sort((left, right) => left.offset - right.offset);
  let buffers = [];
  let start = 0;
  let end = 0;
  const flush = async () => {
    if (buffers.length) await writeRange(handle, Buffer.concat(buffers), start);
    buffers = [];
  };
  for (const { bytes, offset } of ordered) {
    if (buffers.length && offset !== end) await flush();
    if (!buffers.length) start = offset;
    buffers.push(bytes);
    end = offset + bytes.length;
  }
  await flush();
}

class ImmutableSegmentBatch {
  constructor(store, tail) {
    this.store = store;
    this.previousTail = requireImmutableSegmentTail(tail);
    this.tail = tail === null ? null : { ...tail };
    this.records = new Map();
    this.digests = new Map();
    this.segments = tail === null ? [] : [{ id: tail.segmentId, end: tail.end }];
    this.bytes = 0;
    this.state = "collecting";
  }

  stage(bytes) {
    if (this.state !== "collecting") throw new Error("Immutable segment batch is sealed");
    if (!Buffer.isBuffer(bytes) || bytes.length > IMMUTABLE_SEGMENT.recordBytes)
      throw new TypeError("Immutable segment record exceeds protocol limit");
    const digest = contentDigest(bytes);
    const existing = this.digests.get(digest);
    if (existing !== undefined) {
      if (!this.records.get(existing).equals(bytes))
        throw immutableStorageError("Immutable record digest collision");
      return existing;
    }
    if (
      this.bytes + bytes.length > IMMUTABLE_TRANSACTION_BUDGET.bytes ||
      this.records.size >= IMMUTABLE_TRANSACTION_BUDGET.objects
    )
      throw Object.assign(new Error("Immutable transaction staging budget exceeded"), {
        code: "SESSION_TRANSACTION_BUDGET_EXCEEDED",
      });
    let segment = this.segments.at(-1);
    if (!segment || segment.end + bytes.length > IMMUTABLE_SEGMENT.bytes) {
      segment = { id: randomUUID().replaceAll("-", ""), end: MAGIC.length };
      this.segments.push(segment);
    }
    const reference = encodeImmutableRecordReference({
      segmentId: segment.id,
      offset: segment.end,
      length: bytes.length,
      digest,
    });
    segment.end += bytes.length;
    this.records.set(reference, Buffer.from(bytes));
    this.digests.set(digest, reference);
    this.bytes += bytes.length;
    return reference;
  }

  release() {
    if (this.state === "publishing") throw new Error("Cannot release a publishing segment batch");
    if (this.state === "collecting") this.state = "discarded";
    this.records.clear();
    this.digests.clear();
    this.segments.length = 0;
    this.bytes = 0;
  }

  async publish(references) {
    if (this.state !== "collecting") throw new Error("Immutable segment batch is sealed");
    if (!Array.isArray(references) || new Set(references).size !== references.length)
      throw new TypeError("Immutable publication requires unique reachable records");
    const grouped = new Map();
    for (const reference of references) {
      const record = decodeImmutableRecordReference(reference);
      const bytes = this.records.get(reference);
      if (bytes === undefined) throw new TypeError("Cannot publish a record outside its batch");
      if (!grouped.has(record.segmentId)) grouped.set(record.segmentId, []);
      grouped.get(record.segmentId).push({ ...record, bytes });
    }
    this.state = "publishing";
    try {
      await this.publishGroups(grouped);
      this.state = "published";
    } catch (error) {
      this.state = "failed";
      throw error;
    } finally {
      this.release();
    }
  }

  async publishGroups(grouped) {
    if (!grouped.size) return;
    const createsFiles = [...grouped.keys()].some((id) => id !== this.previousTail?.segmentId);
    if (createsFiles) await fsMkdir(this.store.directory, { recursive: true });
    for (const { id } of this.segments) {
      const records = grouped.get(id);
      if (!records) continue;
      if (id === this.previousTail?.segmentId)
        await this.store.appendSegment(this.previousTail, records);
      else await this.store.publishSegment(id, records);
      this.tail = {
        segmentId: id,
        end: Math.max(...records.map(({ offset, length }) => offset + length)),
      };
    }
    if (createsFiles) {
      await syncStorageDirectory(this.store.directory);
      await syncStorageDirectory(path.dirname(this.store.directory));
    }
  }
}

export class ImmutableSegmentStore {
  constructor(sessionDir) {
    this.directory = path.join(sessionDir, IMMUTABLE_SEGMENT.directory);
    this.readScopes = new AsyncLocalStorage();
  }

  async withReadScope(operation) {
    if (this.readScopes.getStore()) throw new Error("Nested immutable segment read scope");
    const scope = { active: true, handles: new Map() };
    return withStorageCleanup(
      () => this.readScopes.run(scope, operation),
      async () => {
        scope.active = false;
        const closed = await Promise.allSettled(
          [...scope.handles.values()].map(async (lease) => {
            const opened = await lease.pending;
            await opened.handle.close();
          }),
        );
        scope.handles.clear();

        const errors = closed
          .filter((outcome) => outcome.status === "rejected")
          .map((outcome) => outcome.reason);
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, "Segment descriptor release failed");
      },
    );
  }

  async openReadSegment(segmentId) {
    const handle = await fsOpen(this.segmentPath(segmentId), "r");
    try {
      const { size } = await handle.stat();
      if (size > IMMUTABLE_SEGMENT.bytes || size < MAGIC.length)
        throw immutableStorageError("Invalid immutable segment size");
      const header = await readRange(handle, 0, MAGIC.length);
      recordStorageWork("immutableReadBytes", MAGIC.length);
      if (!header.equals(MAGIC)) throw immutableStorageError("Invalid immutable segment header");
      return { handle, size };
    } catch (error) {
      return withStorageCleanup(
        async () => {
          throw error;
        },
        () => handle.close(),
      );
    }
  }

  segmentPath(id) {
    return path.join(this.directory, immutableSegmentFileName(id));
  }

  createBatch(tail = null) {
    return new ImmutableSegmentBatch(this, tail);
  }

  async validateTail(tail) {
    requireImmutableSegmentTail(tail);
    if (tail === null) return;
    let opened;
    try {
      await withStorageCleanup(
        async () => {
          opened = await this.openReadSegment(tail.segmentId);
          if (opened.size < tail.end)
            throw immutableStorageError("Committed segment tail is truncated");
        },
        () => opened?.handle.close(),
      );
    } catch (cause) {
      throw immutableStorageError("Cannot validate committed segment tail", cause);
    }
  }

  async appendSegment(tail, records) {
    requireImmutableSegmentTail(tail);
    const { handle, size } = await this.openAppendSegment(tail);
    await withStorageCleanup(
      async () => {
        if (size !== tail.end) await handle.truncate(tail.end);
        for (const { offset } of records) {
          if (offset < tail.end) throw immutableStorageError("Append overlaps committed bytes");
        }
        await writeRecords(handle, records);
        await handle.sync();

        const lease = this.readScopes.getStore()?.handles.get(tail.segmentId);
        if (lease) {
          const opened = await lease.pending;
          opened.size = Math.max(...records.map(({ offset, length }) => offset + length));
        }
        recordStorageWork("immutableSegmentSyncs");
        recordStorageWork("immutableSegmentWrites");
        recordStorageWork(
          "immutableWriteBytes",
          records.reduce((sum, r) => sum + r.bytes.length, 0),
        );
      },
      () => handle.close(),
    );
  }

  async openAppendSegment(tail) {
    const handle = await fsOpen(this.segmentPath(tail.segmentId), "r+");
    try {
      const { size } = await handle.stat();
      if (size < tail.end || size > IMMUTABLE_SEGMENT.bytes)
        throw immutableStorageError("Committed segment tail is truncated or oversized");
      if (!(await readRange(handle, 0, MAGIC.length)).equals(MAGIC))
        throw immutableStorageError("Invalid immutable segment header");
      return { handle, size };
    } catch (error) {
      return withStorageCleanup(
        async () => {
          throw error;
        },
        () => handle.close(),
      );
    }
  }

  async publishSegment(id, records) {
    const file = this.segmentPath(id);
    await publishSyncedFile(
      file,
      async (handle) => {
        await writeRange(handle, MAGIC, 0);
        await writeRecords(handle, records);
        await handle.truncate(
          records.reduce((end, { offset, length }) => Math.max(end, offset + length), MAGIC.length),
        );
      },
      "immutableSegmentSyncs",
    );
    recordStorageWork("immutableSegmentWrites");
    recordStorageWork(
      "immutableWriteBytes",
      MAGIC.length + records.reduce((sum, record) => sum + record.bytes.length, 0),
    );
  }

  evictIdleReadSegment(scope) {
    for (const [id, candidate] of scope.handles) {
      if (candidate.users) continue;
      scope.handles.delete(id);
      return candidate.pending.then((opened) => opened.handle.close());
    }
  }

  async acquireReadSegment(segmentId, scope) {
    if (!scope) {
      const opened = await this.openReadSegment(segmentId);
      return { opened, release: () => opened.handle.close() };
    }
    let lease = scope.handles.get(segmentId);
    if (!lease) {
      let closing;
      if (scope.handles.size >= IMMUTABLE_SEGMENT.transactionReadHandles) {
        closing = this.evictIdleReadSegment(scope);
      }
      lease = {
        users: 0,
        pending: (async () => {
          await closing;
          return this.openReadSegment(segmentId);
        })(),
      };
    } else scope.handles.delete(segmentId);
    scope.handles.set(segmentId, lease);
    lease.users += 1;
    try {
      const opened = await lease.pending;
      return {
        opened,
        release: async () => {
          lease.users -= 1;
          if (!lease.users && scope.handles.size > IMMUTABLE_SEGMENT.transactionReadHandles) {
            scope.handles.delete(segmentId);
            await opened.handle.close();
          }
        },
      };
    } catch (error) {
      lease.users -= 1;
      if (!lease.users) scope.handles.delete(segmentId);
      throw error;
    }
  }

  async read(reference) {
    const record = decodeImmutableRecordReference(reference);
    return this.readRecords([record]);
  }

  async verifyMany(references) {
    const records = [...new Set(references)].map(decodeImmutableRecordReference);
    records.sort((left, right) => {
      if (left.segmentId < right.segmentId) return -1;
      if (left.segmentId > right.segmentId) return 1;
      return left.offset - right.offset;
    });
    const groups = [];
    for (const record of records) {
      const previous = groups.at(-1);
      const tail = previous?.at(-1);
      if (
        tail?.segmentId === record.segmentId &&
        tail.offset + tail.length === record.offset &&
        previous.length < IMMUTABLE_VALUE_READ_BATCH_RECORDS
      )
        previous.push(record);
      else groups.push([record]);
    }
    await runStorageBatch(groups, (group) => this.readRecords(group));
  }

  async readRecords(records) {
    const record = records[0];
    const last = records.at(-1);
    const length = last.offset + last.length - record.offset;
    const scope = this.readScopes.getStore();
    if (scope && !scope.active) throw new Error("Immutable segment read scope has ended");
    let opened;
    let release;
    try {
      return await withStorageCleanup(
        async () => {
          ({ opened, release } = await this.acquireReadSegment(record.segmentId, scope));
          if (opened.size < record.offset + length)
            throw immutableStorageError("Invalid immutable segment size");
          const bytes = await readRange(opened.handle, record.offset, length);
          recordStorageWork("immutableObjectReads", records.length);
          recordStorageWork("immutableReadBytes", bytes.length);
          for (const selected of records) {
            const offset = selected.offset - record.offset;
            if (contentDigest(bytes.subarray(offset, offset + selected.length)) !== selected.digest)
              throw immutableStorageError("Immutable segment record checksum mismatch");
          }
          return bytes;
        },
        async () => {
          if (release) await release();
        },
      );
    } catch (cause) {
      throw immutableStorageError(
        `Cannot read immutable segment record ${encodeImmutableRecordReference(record)}`,
        cause,
      );
    }
  }
}
