/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  requireImmutableRecordReference,
  decodeImmutableRecordReference,
} from "@noobot/session-protocol/immutable-segment";
import {
  immutablePageReferences,
  IMMUTABLE_TRANSACTION_READ_CACHE,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  decodeImmutableJsonBytes,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSegmentStore } from "./immutable-segment-store.js";
import {
  restoreImmutableSegmentRecords,
  prepareImmutableSegmentRepair,
} from "./immutable-segment-repair.js";
import { ImmutableTransactionGraph } from "./immutable-transaction-graph.js";
import { ImmutableValueStore } from "./immutable-value-store.js";

export class ImmutableRecordStore extends ImmutableValueStore {
  static format = IMMUTABLE_SEGMENT_SESSION_FORMAT;

  constructor(sessionDir) {
    super();
    this.segments = new ImmutableSegmentStore(sessionDir);
    this.writeBatches = new AsyncLocalStorage();
    this.readScopes = new AsyncLocalStorage();
  }

  restoreRecords(replacements, { signal } = {}) {
    return restoreImmutableSegmentRecords(this.segments, replacements, signal);
  }

  requireReference(reference) {
    return requireImmutableRecordReference(reference);
  }

  referenceDigest(reference) {
    return decodeImmutableRecordReference(reference).digest;
  }

  batch({ writable = false } = {}) {
    const batch = this.writeBatches.getStore();
    if (!batch?.active || (writable && batch.phase !== "collecting"))
      throw new Error("Immutable record transaction is not accepting writes");
    return batch;
  }

  async withReadScope(operation) {
    const current = this.readScopes.getStore();
    if (current) {
      if (!current.active) throw new Error("Immutable record read scope has ended");
      return operation();
    }
    const scope = { active: true, reads: new Map(), readBytes: 0 };
    try {
      return await this.segments.withReadScope(() => this.readScopes.run(scope, operation));
    } finally {
      scope.active = false;
      scope.reads.clear();
      scope.readBytes = 0;
    }
  }

  async withDurabilityBatch(operation) {
    if (this.writeBatches.getStore()) throw new Error("Nested immutable durability batch");
    const batch = {
      active: true,
      phase: "collecting",
      records: this.segments.createBatch(),
      graph: new ImmutableTransactionGraph(requireImmutableRecordReference),
    };
    try {
      return await this.withReadScope(() => this.writeBatches.run(batch, operation));
    } finally {
      batch.active = false;
      batch.graph.clear();
      batch.records.release();
    }
  }

  initialHeadFields() {
    return { segmentTail: null };
  }

  async validateSnapshot(head, overrides) {
    const tail = head.segmentTail;
    if (tail === null) return;
    const records = [];
    for (const [reference, bytes] of overrides ?? []) {
      const record = decodeImmutableRecordReference(reference);
      if (record.segmentId === tail.segmentId) records.push({ ...record, bytes });
    }
    if (!records.length) return this.segments.validateTail(tail);

    const { restored } = await prepareImmutableSegmentRepair(
      this.segments,
      tail.segmentId,
      records,
    );
    if (restored.length < tail.end)
      throw immutableStorageError("Repair does not restore the committed segment tail");
  }

  beginCommit(head) {
    const batch = this.batch({ writable: true });
    if (batch.graph.objects.size)
      throw new Error("Append boundary must precede transaction writes");
    batch.records.release();
    batch.records = this.segments.createBatch(head.segmentTail);
  }

  publicationHeadFields() {
    const batch = this.batch();
    if (batch.phase !== "published") throw new Error("Append state is not published");
    return { segmentTail: batch.records.tail };
  }

  async put(bytes) {
    const batch = this.batch({ writable: true });
    const reference = batch.records.stage(bytes);
    batch.graph.put(reference, batch.records.records.get(reference));
    return reference;
  }

  linkReferences(reference, references) {
    this.batch({ writable: true }).graph.link(reference, references);
  }

  async putPage(page) {
    this.batch({ writable: true });
    const references = immutablePageReferences(page, requireImmutableRecordReference);
    const reference = await this.put(Buffer.from(JSON.stringify(page)));
    this.linkReferences(reference, references);
    return reference;
  }

  rememberRead(scope, reference, bytes) {
    if (!scope?.active || bytes.length > IMMUTABLE_TRANSACTION_READ_CACHE.bytes) return;
    if (scope.reads.has(reference)) return;
    while (
      scope.readBytes + bytes.length > IMMUTABLE_TRANSACTION_READ_CACHE.bytes ||
      scope.reads.size >= IMMUTABLE_TRANSACTION_READ_CACHE.records
    ) {
      const oldest = scope.reads.keys().next().value;
      scope.readBytes -= scope.reads.get(oldest).length;
      scope.reads.delete(oldest);
    }
    scope.reads.set(reference, Buffer.from(bytes));
    scope.readBytes += bytes.length;
  }

  async read(reference) {
    this.requireReference(reference);
    const batch = this.writeBatches.getStore();
    if (batch && !batch.active) throw new Error("Immutable durability batch has ended");
    const staged = batch?.graph.objects.get(reference);
    if (staged !== undefined) return Buffer.from(staged);
    const scope = this.readScopes.getStore();
    if (scope && !scope.active) throw new Error("Immutable record read scope has ended");
    const cached = scope?.reads.get(reference);
    if (cached !== undefined) return Buffer.from(cached);
    const bytes = await this.segments.read(reference);
    this.rememberRead(scope, reference, bytes);
    return bytes;
  }

  async readPage(reference) {
    return decodeImmutableJsonBytes(await this.read(reference), reference);
  }

  async publishReachable(roots) {
    const batch = this.batch({ writable: true });
    const records = batch.graph.reachable(roots);
    batch.phase = "publishing";
    try {
      await batch.records.publish(records.map(({ reference }) => reference));
      batch.phase = "published";
      batch.graph.clear();
    } catch (error) {
      batch.phase = "failed";
      throw error;
    }
  }
}
