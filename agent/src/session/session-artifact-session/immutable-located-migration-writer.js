/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  IMMUTABLE_SEGMENT,
  requireImmutableContentDigest,
} from "@noobot/session-protocol/immutable-segment";
import { IMMUTABLE_TRANSACTION_BUDGET } from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableValueStore } from "./immutable-value-store.js";
import { ImmutableLocatedRecordStore } from "./immutable-located-record-store.js";
import { contentDigest } from "./immutable-storage-io.js";

export class ImmutableLocatedMigrationWriter extends ImmutableValueStore {
  constructor(sessionDir, sourceHead) {
    super();
    this.objects = new ImmutableLocatedRecordStore(sessionDir);
    this.head = {
      sessionId: sourceHead.sessionId,
      generation: 0,
      root: null,
      operations: null,
      commit: null,
      format: ImmutableLocatedRecordStore.format,
      ...this.objects.initialHeadFields(),
    };
    if (sourceHead.format === ImmutableLocatedRecordStore.format) this.head = { ...sourceHead };
    this.records = new Map();
    this.bytes = 0;
    this.queue = Promise.resolve();
  }

  requireReference(reference) {
    return requireImmutableContentDigest(reference);
  }

  linkReferences() {}

  put(bytes) {
    const operation = this.queue.then(async () => {
      if (
        this.bytes + bytes.length > IMMUTABLE_SEGMENT.bytes ||
        this.records.size >= IMMUTABLE_TRANSACTION_BUDGET.objects
      )
        await this.flush();
      const reference = contentDigest(bytes);
      if (!this.records.has(reference)) {
        this.records.set(reference, Buffer.from(bytes));
        this.bytes += bytes.length;
      }
      return reference;
    });
    this.queue = operation;
    return operation;
  }

  putPage(page) {
    return this.put(Buffer.from(JSON.stringify(page)));
  }

  async flush() {
    if (!this.records.size) return;
    await this.objects.withDurabilityBatch(async () => {
      this.objects.beginCommit(this.head);
      const roots = [];
      for (const bytes of this.records.values()) roots.push(await this.objects.put(bytes));
      await this.objects.publishReachable(roots);
      this.head = { ...this.head, ...this.objects.publicationHeadFields() };
    });
    this.records.clear();
    this.bytes = 0;
  }

  async finish() {
    await this.queue;
    await this.flush();
    return { locationRoot: this.head.locationRoot, segmentTail: this.head.segmentTail };
  }

  release() {
    this.records.clear();
    this.bytes = 0;
  }
}
