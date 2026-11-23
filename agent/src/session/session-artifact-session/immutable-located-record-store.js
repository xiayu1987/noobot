/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate } from "node:timers/promises";
import {
  IMMUTABLE_LOCATED_SESSION_FORMAT,
  encodeImmutableLocationPage,
  decodeImmutableLocationPage,
  requireImmutableLocationPagePath,
  immutableLocationPageByteLength,
  requireImmutableLocatedSnapshot,
  requireImmutableRecordLocation,
  requireImmutableRelocationSource,
  immutableRelocationSourceChanged,
  immutableRecordStillReachable,
} from "@noobot/session-protocol/immutable-record-location";
import {
  requireImmutableContentDigest,
  requireImmutableRecordReference,
  decodeImmutableRecordReference,
} from "@noobot/session-protocol/immutable-segment";
import {
  IMMUTABLE_TRANSACTION_READ_CACHE,
  immutablePageReferences,
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_LOCATION_INDEX_TARGET_BYTES,
  IMMUTABLE_VALUE_READ_BATCH_RECORDS,
  freezeImmutableIndexPage,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  decodeImmutableJsonBytes,
  immutableStorageError,
  requireImmutableStoredContent,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
} from "@noobot/session-protocol/immutable-storage";
import { contentDigest } from "./immutable-storage-io.js";
import { ImmutableSegmentStore } from "./immutable-segment-store.js";
import { ImmutableTransactionGraph } from "./immutable-transaction-graph.js";
import {
  ImmutableRadixIndex,
  readImmutableIndexPages,
  validateImmutableIndexPage,
} from "./immutable-radix-index.js";
import { recordStorageWork } from "../session-storage-observation.js";
import { ImmutableValueStore } from "./immutable-value-store.js";
import { runStorageBatch } from "./storage-batch-results.js";
import {
  restoreImmutableSegmentRecords,
  prepareImmutableSegmentRepair,
} from "./immutable-segment-repair.js";

function readCachedEntry(scope, key) {
  const entry = scope?.records.get(key);
  if (entry !== undefined) {
    scope.records.delete(key);
    scope.records.set(key, entry);
  }
  return entry;
}

class LocationPages {
  constructor(owner) {
    this.owner = owner;
  }

  requireReference(reference) {
    return requireImmutableRecordReference(reference);
  }

  async readPage(reference) {
    this.requireReference(reference);
    const staged = this.owner.writes.getStore()?.records.records.get(reference);
    if (staged !== undefined) return this.owner.decodeLocationPage(staged, reference);
    const bytes = await this.owner.loadPhysical(reference);
    recordStorageWork("immutableLocationPageReadBytes", bytes.length);
    return this.owner.decodeLocationPage(bytes, reference);
  }

  async readIndexPage(reference, prefix) {
    return this.owner.readCachedIndexPage(reference, prefix, "physical", async () => {
      recordStorageWork("immutableIndexPageReads");
      const page = this.owner.requireLocationPagePath(await this.readPage(reference), prefix);
      return { page, size: immutableLocationPageByteLength(page) };
    });
  }

  async putIndexPage(page, prefix) {
    const bytes = this.owner.encodeLocationPage(page);
    this.owner.requireLocationPagePath(page, prefix);
    const records = this.owner.batch("publishing").records;
    const before = records.bytes;
    const reference = records.stage(bytes);
    recordStorageWork("immutableLocationPageStagedBytes", records.bytes - before);
    this.owner.rememberIndexPage(reference, prefix, "physical", page);
    return reference;
  }

  async readIndexPages(nodes) {
    return readImmutableIndexPages(this, nodes);
  }
}

export class ImmutableLocatedRecordStore extends ImmutableValueStore {
  static format = IMMUTABLE_LOCATED_SESSION_FORMAT;

  encodeLocationPage(page) {
    return encodeImmutableLocationPage(page);
  }

  decodeLocationPage(bytes) {
    return decodeImmutableLocationPage(bytes);
  }

  requireLocationPagePath(page, prefix) {
    return requireImmutableLocationPagePath(page, prefix);
  }

  constructor(sessionDir, objectRead) {
    super(objectRead);
    this.segments = new ImmutableSegmentStore(sessionDir);
    this.writes = new AsyncLocalStorage();
    this.snapshots = new AsyncLocalStorage();
    this.reads = new AsyncLocalStorage();
    this.repairs = new AsyncLocalStorage();
    this.locations = new ImmutableRadixIndex(
      new LocationPages(this),
      IMMUTABLE_LOCATION_INDEX_TARGET_BYTES,
    );
  }

  requireReference(reference) {
    return requireImmutableContentDigest(reference);
  }

  referenceDigest(reference) {
    return this.requireReference(reference);
  }

  initialHeadFields() {
    return { locationRoot: null, segmentTail: null };
  }

  batch(phase = "collecting") {
    const batch = this.writes.getStore();
    if (!batch?.active || batch.phase !== phase)
      throw new Error("Located record transaction is not in the required publication phase");
    return batch;
  }

  async withReadScope(operation) {
    const current = this.reads.getStore();
    if (current) {
      if (!current.active) throw new Error("Located record read scope has ended");
      return operation();
    }
    const scope = { active: true, bytes: 0, records: new Map() };
    try {
      return await this.segments.withReadScope(() => this.reads.run(scope, operation));
    } finally {
      scope.active = false;
      scope.records.clear();
      scope.bytes = 0;
    }
  }

  async withSnapshot(snapshot, operation) {
    requireImmutableLocatedSnapshot(snapshot);
    return this.withReadScope(() => this.snapshots.run(snapshot, operation));
  }

  async withDurabilityBatch(operation) {
    if (this.writes.getStore()) throw new Error("Nested located durability batch");
    const batch = {
      active: true,
      phase: "collecting",
      snapshot: null,
      locationRoot: null,
      relocations: new Set(),
      retirements: new Set(),
      records: this.segments.createBatch(),
      graph: new ImmutableTransactionGraph(requireImmutableContentDigest),
    };
    try {
      return await this.withReadScope(() => this.writes.run(batch, operation));
    } finally {
      batch.active = false;
      batch.graph.clear();
      batch.relocations.clear();
      batch.retirements.clear();
      batch.records.release();
    }
  }

  beginCommit(snapshot) {
    requireImmutableLocatedSnapshot(snapshot);
    const batch = this.batch();
    if (batch.snapshot !== null || batch.graph.objects.size)
      throw new Error("Located append boundary must precede transaction writes");
    batch.snapshot = snapshot;
    batch.locationRoot = snapshot.locationRoot;
    batch.records.release();
    batch.records = this.segments.createBatch(snapshot.segmentTail);
  }

  async *physicalReferences(snapshot, { signal } = {}) {
    requireImmutableLocatedSnapshot(snapshot);

    const visit = async function* (owner, reference, prefix) {
      signal?.throwIfAborted();
      if (reference === null) return;
      const page = await owner.locations.readPage(reference, prefix);

      if (signal) {
        await setImmediate();
        signal.throwIfAborted();
      }
      yield reference;
      if (page.kind === "index-leaf") {
        for (const [identity, location] of page.entries) {
          signal?.throwIfAborted();
          requireImmutableRecordLocation(identity, location);
          yield location;
        }
      } else {
        for (const [digit, child] of Object.entries(page.children))
          yield* visit(owner, child, prefix + digit);
      }
    };
    yield* visit(this, snapshot.locationRoot, "");
  }

  async physicalReplacements(snapshot, replacements) {
    const physical = new Map();
    const signal = this.repairs.getStore()?.signal;

    for await (const location of this.physicalReferences(snapshot, { signal })) {
      const record = decodeImmutableRecordReference(location);
      if (!replacements.has(record.digest)) continue;
      const bytes = replacements.get(record.digest);
      requireImmutableStoredContent(
        location,
        { digest: contentDigest(bytes), length: bytes.length },
        IMMUTABLE_SEGMENT_SESSION_FORMAT,
      );
      physical.set(location, bytes);

      if (signal) {
        await setImmediate();
        signal.throwIfAborted();
      }
    }
    return physical;
  }

  async withPhysicalRepairOverlay({ replacements, used, signal }, operation) {
    return this.repairs.run({ replacements, used, signal }, operation);
  }

  async restoreRecords(replacements, { signal, snapshots } = {}) {
    if (!Array.isArray(snapshots) || !snapshots.length)
      throw new TypeError("Located repair requires explicitly retained snapshots");
    const physical = new Map();
    for (const snapshot of snapshots) {
      requireImmutableLocatedSnapshot(snapshot);
      signal?.throwIfAborted();
      for (const [location, bytes] of await this.physicalReplacements(snapshot, replacements))
        physical.set(location, bytes);
    }
    return restoreImmutableSegmentRecords(this.segments, physical, signal);
  }

  async tailRepairRecords(snapshot, overrides) {
    if (snapshot.segmentTail === null || !overrides) return [];
    const records = [];
    for (const [location, bytes] of await this.physicalReplacements(snapshot, overrides)) {
      const record = decodeImmutableRecordReference(location);
      if (record.segmentId === snapshot.segmentTail.segmentId) records.push({ ...record, bytes });
    }
    return records;
  }

  async validateSnapshot(snapshot, overrides) {
    requireImmutableLocatedSnapshot(snapshot);
    const tail = snapshot.segmentTail;
    const records = await this.tailRepairRecords(snapshot, overrides);
    if (records.length) {
      const { restored } = await prepareImmutableSegmentRepair(
        this.segments,
        tail.segmentId,
        records,
      );
      if (restored.length < tail.end)
        throw immutableStorageError("Repair does not restore the committed located tail");
    } else await this.segments.validateTail(tail);
    if (snapshot.locationRoot !== null) await this.locations.readPage(snapshot.locationRoot, "");
  }

  snapshot() {
    const pinned = this.snapshots.getStore();
    if (pinned) return pinned;
    const batch = this.writes.getStore();
    if (batch) {
      if (!batch.active) throw new Error("Located durability batch has ended");
      if (batch.snapshot !== null) return { ...batch.snapshot, locationRoot: batch.locationRoot };
    }
    throw new Error("Located record reads require a pinned snapshot");
  }

  rememberRead(scope, key, entry) {
    if (!scope || !scope.active || entry.size > IMMUTABLE_TRANSACTION_READ_CACHE.bytes) return;
    if (scope.records.has(key)) return;
    while (
      scope.bytes + entry.size > IMMUTABLE_TRANSACTION_READ_CACHE.bytes ||
      scope.records.size >= IMMUTABLE_TRANSACTION_READ_CACHE.records
    ) {
      const oldest = scope.records.keys().next().value;
      scope.bytes -= scope.records.get(oldest).size;
      scope.records.delete(oldest);
    }
    scope.records.set(key, entry);
    scope.bytes += entry.size;
  }

  async readScopedEntry(key, load) {
    const scope = this.reads.getStore();
    if (!scope) return load();
    if (!scope.active) throw new Error("Located record read scope has ended");
    const cached = readCachedEntry(scope, key);
    if (cached !== undefined) {
      cached.shared = true;
      return cached.pending ?? cached;
    }

    const entry = { size: Buffer.byteLength(key), shared: false };
    entry.pending = Promise.resolve().then(load);
    this.rememberRead(scope, key, entry);
    try {
      const loaded = await entry.pending;
      if (!scope.active) throw new Error("Located record read scope has ended");
      loaded.shared = entry.shared;
      return loaded;
    } finally {
      if (scope.records.get(key) === entry) {
        scope.records.delete(key);
        scope.bytes -= entry.size;
      }
    }
  }

  activeReadBatch() {
    const batch = this.writes.getStore();
    if (batch && !batch.active) throw new Error("Located durability batch has ended");
    return batch;
  }

  async readIndexPage(reference, prefix) {
    this.requireReference(reference);
    const staged = this.activeReadBatch()?.graph.objects.get(reference);
    const location = staged === undefined ? await this.locateCommittedRecord(reference) : "staged";
    return this.readResolvedIndexPage(reference, prefix, location, staged);
  }

  readResolvedIndexPage(reference, prefix, location, staged) {
    return this.readCachedIndexPage(reference, prefix, location, async () => {
      recordStorageWork("immutableIndexPageReads");
      const bytes = await this.readLocatedObject(reference, location, staged);
      const page = validateImmutableIndexPage(
        decodeImmutableJsonBytes(bytes, reference),
        prefix,
        this.requireReference.bind(this),
      );
      return { page, size: bytes.length };
    });
  }

  async putIndexPage(page, prefix) {
    const reference = await super.putIndexPage(page, prefix);
    this.rememberIndexPage(reference, prefix, "staged", page);
    return reference;
  }

  async readIndexPages(nodes) {
    const pages = [];
    for (let offset = 0; offset < nodes.length; offset += IMMUTABLE_VALUE_READ_BATCH_RECORDS) {
      const selected = nodes.slice(offset, offset + IMMUTABLE_VALUE_READ_BATCH_RECORDS);
      const batch = this.activeReadBatch();
      for (const { reference } of selected) this.requireReference(reference);
      const committed = selected
        .filter(({ reference }) => !batch?.graph.objects.has(reference))
        .map(({ reference }) => reference);
      const locations = committed.length
        ? await this.locateRecords(this.snapshot().locationRoot, committed)
        : new Map();
      pages.push(
        ...(await readImmutableIndexPages(
          {
            readIndexPage: (reference, prefix) => {
              const staged = batch?.graph.objects.get(reference);
              const location = staged === undefined ? locations.get(reference) : "staged";
              return this.readResolvedIndexPage(reference, prefix, location, staged);
            },
          },
          selected,
        )),
      );
    }
    return pages;
  }

  rememberIndexPage(reference, prefix, snapshotRoot, page) {
    this.rememberRead(this.reads.getStore(), `index:${snapshotRoot}:${prefix}:${reference}`, {
      page: freezeImmutableIndexPage(page),
      size: Buffer.byteLength(JSON.stringify(page)),
    });
  }

  async readCachedIndexPage(reference, prefix, snapshotRoot, load) {
    const key = `index:${snapshotRoot}:${prefix}:${reference}`;
    const entry = await this.readScopedEntry(key, async () => {
      const { page, size } = await load();
      return {
        page: freezeImmutableIndexPage(page),
        size,
      };
    });
    this.rememberRead(this.reads.getStore(), key, entry);
    return entry.page;
  }

  repairedPhysical(reference) {
    const repair = this.repairs.getStore();
    if (repair) {
      const record = decodeImmutableRecordReference(reference);
      const bytes = repair.replacements?.get(record.digest);
      if (bytes !== undefined) {
        requireImmutableStoredContent(
          reference,
          { digest: contentDigest(bytes), length: bytes.length },
          IMMUTABLE_SEGMENT_SESSION_FORMAT,
        );
        repair.used.add(record.digest);
        return Buffer.from(bytes);
      }
    }
    return undefined;
  }

  async loadPhysical(reference) {
    return this.repairedPhysical(reference) ?? this.#readSegment(reference);
  }

  #readSegment(reference) {
    this.repairs.getStore()?.signal?.throwIfAborted();
    return this.segments.read(reference);
  }

  async readPhysical(reference) {
    const repaired = this.repairedPhysical(reference);
    if (repaired !== undefined) return repaired;
    const entry = await this.readScopedEntry(reference, async () => ({
      bytes: await this.#readSegment(reference),
    }));
    return entry.shared ? Buffer.from(entry.bytes) : entry.bytes;
  }

  async put(bytes) {
    const batch = this.batch();
    if (!batch.snapshot) throw new Error("Located transaction requires an append boundary");
    if (!Buffer.isBuffer(bytes) || bytes.length > IMMUTABLE_VALUE_BLOCK_BYTES)
      throw new TypeError("Located records require bounded Buffer bytes");
    const reference = contentDigest(bytes);
    const previous = batch.graph.objects.get(reference);
    if (previous !== undefined && !previous.equals(bytes))
      throw immutableStorageError("Located record content digest collision");
    batch.graph.put(reference, Buffer.from(bytes));
    return reference;
  }

  linkReferences(reference, references) {
    this.batch().graph.link(reference, references);
  }

  async relocate(source) {
    const batch = this.batch();
    const { identity: reference, sourceLocation } = requireImmutableRelocationSource(source);
    if (!batch.snapshot) throw new Error("Located transaction requires an append boundary");
    const location = await this.locations.get(batch.snapshot.locationRoot, reference);
    if (location !== sourceLocation) throw immutableRelocationSourceChanged(source, location);
    requireImmutableRecordLocation(reference, location);
    const bytes = await this.readPhysical(location);
    const relocated = await this.put(bytes);
    batch.relocations.add(reference);
    return relocated;
  }

  async retireLocation(source) {
    const batch = this.batch();
    const { identity, sourceLocation } = requireImmutableRelocationSource(source);
    if (!batch.snapshot) throw new Error("Location retirement requires an append boundary");
    const location = await this.locations.get(batch.snapshot.locationRoot, identity);
    if (location === null) throw immutableStorageError("Retirement source location is missing");
    requireImmutableRecordLocation(identity, location);
    if (location !== sourceLocation) throw immutableRelocationSourceChanged(source, location);
    batch.retirements.add(identity);
  }

  async putPage(page) {
    const references = immutablePageReferences(page, requireImmutableContentDigest);
    const reference = await this.put(Buffer.from(JSON.stringify(page)));
    this.linkReferences(reference, references);
    return reference;
  }

  async locateRecord(locationRoot, reference) {
    this.requireReference(reference);
    const scope = this.reads.getStore();
    if (scope && !scope.active) throw new Error("Located record read scope has ended");
    const cached = readCachedEntry(scope, `location:${locationRoot}:${reference}`);
    if (cached !== undefined) return cached.location;
    return (await this.locateRecords(locationRoot, [reference])).get(reference);
  }

  async locateRecords(locationRoot, references) {
    const scope = this.reads.getStore();
    if (scope && !scope.active) throw new Error("Located record read scope has ended");
    const locations = new Map();
    const missing = [];
    for (const reference of new Set(references)) {
      this.requireReference(reference);
      const cached = readCachedEntry(scope, `location:${locationRoot}:${reference}`);
      if (cached === undefined) missing.push(reference);
      else locations.set(reference, cached.location);
    }
    if (!missing.length) return locations;
    const resolved = await this.locations.getMany(locationRoot, missing);

    for (const reference of missing) {
      const location = resolved.get(reference);
      if (location === null) throw immutableStorageError("Committed record location is missing");
      requireImmutableRecordLocation(reference, location);
    }
    for (const reference of missing) {
      const location = resolved.get(reference);
      const key = `location:${locationRoot}:${reference}`;
      this.rememberRead(scope, key, {
        location,
        size: Buffer.byteLength(key) + Buffer.byteLength(location),
      });
      locations.set(reference, location);
    }
    return locations;
  }

  readLocatedObject(reference, location, staged) {
    return this.readObject(reference, this.#loadObject, location, staged);
  }

  #loadObject(location, staged) {
    return staged === undefined ? this.readPhysical(location) : Buffer.from(staged);
  }

  locateCommittedRecord(reference) {
    return this.locateRecord(this.snapshot().locationRoot, reference);
  }

  async read(reference) {
    this.requireReference(reference);
    const staged = this.activeReadBatch()?.graph.objects.get(reference);
    const location = staged === undefined ? await this.locateCommittedRecord(reference) : "staged";
    return this.readLocatedObject(reference, location, staged);
  }

  async readMany(references) {
    const unique = [...new Set(references)];
    for (const reference of unique) this.requireReference(reference);
    const batch = this.activeReadBatch();
    const committed = unique.filter((reference) => !batch?.graph.objects.has(reference));
    const locations = committed.length
      ? await this.locateRecords(this.snapshot().locationRoot, committed)
      : new Map();

    const records = new Map(unique.map((reference) => [reference, undefined]));
    await runStorageBatch(unique, async (reference) => {
      const staged = batch?.graph.objects.get(reference);
      records.set(
        reference,
        await this.readLocatedObject(reference, locations.get(reference), staged),
      );
    });
    return records;
  }

  async readPage(reference) {
    return decodeImmutableJsonBytes(await this.read(reference), reference);
  }

  requireRetirementsUnreachable(batch, roots, records) {
    const requireUnreachable = (reference) => {
      if (batch.retirements.has(reference)) throw immutableRecordStillReachable(reference);
    };
    for (const reference of [...roots, ...batch.relocations]) requireUnreachable(reference);
    for (const { reference } of records) {
      requireUnreachable(reference);
      for (const child of batch.graph.references.get(reference) ?? []) requireUnreachable(child);
    }
  }

  async publishReachable(roots) {
    const batch = this.batch();
    if (!batch.snapshot) throw new Error("Located transaction requires an append boundary");
    const records = batch.graph.reachable([...roots, ...batch.relocations]);

    this.requireRetirementsUnreachable(batch, roots, records);
    batch.phase = "publishing";
    try {
      const bytesByIdentity = new Map(records.map(({ reference, bytes }) => [reference, bytes]));
      const reused = [];
      const result = await this.locations.updateMany(
        batch.locationRoot,
        [...batch.retirements, ...bytesByIdentity.keys()],
        ({ key: identity, previous }) => {
          if (batch.retirements.has(identity)) return null;
          if (previous !== null) requireImmutableRecordLocation(identity, previous);
          if (previous !== null && !batch.relocations.has(identity)) {
            reused.push(previous);
            return previous;
          }
          return batch.records.stage(bytesByIdentity.get(identity));
        },
      );
      await this.segments.verifyMany(
        reused.filter((location) => this.repairedPhysical(location) === undefined),
      );
      batch.locationRoot = result.root;
      await batch.records.publish([...batch.records.records.keys()]);
      batch.phase = "published";
      batch.graph.clear();
    } catch (error) {
      batch.phase = "failed";
      throw error;
    }
  }

  publicationHeadFields() {
    const batch = this.batch("published");
    return { locationRoot: batch.locationRoot, segmentTail: batch.records.tail };
  }
}
