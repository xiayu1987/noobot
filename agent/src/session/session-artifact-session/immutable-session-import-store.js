/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { decodeImmutableJsonBytes } from "@noobot/session-protocol/immutable-storage";
import { ImmutableLocatedMigrationWriter } from "./immutable-located-migration-writer.js";
import { ImmutableLocatedRecordStore } from "./immutable-located-record-store.js";

export class ImmutableSessionImportStore extends ImmutableLocatedMigrationWriter {
  static format = ImmutableLocatedRecordStore.format;

  constructor(sessionDir) {
    super(sessionDir, { sessionId: "" });
    this.active = false;
  }

  initialHeadFields() {
    return this.objects.initialHeadFields();
  }

  referenceDigest(reference) {
    return this.requireReference(reference);
  }

  async withDurabilityBatch(operation) {
    if (this.active) throw new Error("Nested immutable import batch");
    this.active = true;
    try {
      return await this.objects.withReadScope(operation);
    } finally {
      this.active = false;
      this.release();
    }
  }

  beginCommit(snapshot) {
    if (!this.active || this.records.size) throw new Error("Invalid immutable import boundary");
    this.head = { ...snapshot };
  }

  async read(reference) {
    this.requireReference(reference);
    await this.queue;
    const staged = this.records.get(reference);
    if (staged !== undefined) return Buffer.from(staged);
    return this.objects.withSnapshot(this.head, () => this.objects.read(reference));
  }

  async readPage(reference) {
    return decodeImmutableJsonBytes(await this.read(reference), reference);
  }

  async publishReachable() {
    await this.finish();
  }

  publicationHeadFields() {
    return { locationRoot: this.head.locationRoot, segmentTail: this.head.segmentTail };
  }
}
