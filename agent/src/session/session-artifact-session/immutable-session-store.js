/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isFunction } from "@noobot/shared/value";
import { filePath as path } from "@noobot/path-resolver";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session-artifact-files.js";
import { fsAccess, fsMkdir, fsOpen } from "../../shared/storage/fs-adapter.js";
import {
  contentDigest,
  immutableStorageError,
  syncStorageDirectory,
  writeDurableReplacement,
} from "./immutable-object-store.js";
import { ImmutableRadixIndex } from "./immutable-radix-index.js";
import { CurrentImmutableRecordStore } from "./immutable-storage-backends.js";
import { recordStorageWork } from "./storage-transaction.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { buildImmutableCommitRoot } from "./immutable-commit-roots.js";

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";

import {
  IMMUTABLE_SESSION_COLLECTIONS,
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_FORMAT_FILE,
  encodeImmutableSessionHead,
  decodeImmutableSessionHeadBytes,
} from "@noobot/session-protocol/immutable-storage";

import {
  IMMUTABLE_COMMIT_INDEX_VERSION,
  IMMUTABLE_VALUE_READ_BATCH_RECORDS,
  immutableTransactionInputDigest,
  immutableValueContentPaths,
  immutableCollectionValueReferences,
  immutableCommitReferences,
  immutableOperationReceiptReferences,
  requireImmutableCommitRecord,
  requireImmutableOperationId,
  requireImmutableContentReuse,
  requireImmutableSessionChange,
  requireImmutableOperationReceipt,
  assertImmutableOperationRetryAvailable,
} from "@noobot/session-protocol/immutable-storage-graph";

const COLLECTIONS = new Set(IMMUTABLE_SESSION_COLLECTIONS);

async function readEntryBatch(entries, scoped) {
  const selected = [];
  while (selected.length < IMMUTABLE_VALUE_READ_BATCH_RECORDS) {
    const next = await scoped(() => entries.next());
    if (next.done) break;
    selected.push(next.value);
  }
  return selected;
}

function entryKey(collection, key) {
  if (!COLLECTIONS.has(collection) || typeof key !== "string" || !key)
    throw new TypeError("Invalid immutable session collection or key");
  return JSON.stringify([collection, key]);
}

function emptyHead(sessionId, format) {
  return { format, sessionId, generation: 0, root: null, operations: null, commit: null };
}

function encodeHead(head, format) {
  return Buffer.from(encodeImmutableSessionHead(head, format));
}

async function readHeadBytes(handle) {
  const bytes = await readHandlePrefix(handle, LENGTH_THRESHOLDS.immutableStorage.headBytes + 1);
  recordStorageWork("immutableHeadReadBytes", bytes.length);
  return bytes;
}

export class ImmutableSessionStore {
  static async open({ sessionDir, sessionId, objectStore = CurrentImmutableRecordStore }) {
    try {
      const bytes = await readHeadBytes(
        await fsOpen(path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE), "r"),
      );
      const head = decodeImmutableSessionHeadBytes(bytes, sessionId, objectStore.format);
      return new ImmutableSessionStore({ sessionDir, sessionId: head.sessionId, objectStore });
    } catch (cause) {
      throw immutableStorageError("Cannot discover immutable session identity", cause);
    }
  }

  constructor({
    sessionDir,
    sessionId,
    allowCreate = false,
    objectStore = CurrentImmutableRecordStore,
  }) {
    if (typeof sessionId !== "string" || !sessionId) throw new TypeError("sessionId is required");
    this.sessionDir = path.resolve(sessionDir);
    this.sessionId = sessionId;
    this.allowCreate = allowCreate;
    this.headPath = path.join(this.sessionDir, IMMUTABLE_SESSION_HEAD_FILE);
    this.lockPath = resolveSessionArtifactMutationLock(this.sessionDir);
    this.objects = new objectStore(this.sessionDir);
    this.format = objectStore.format;
    this.requireReference = this.objects.requireReference.bind(this.objects);
    this.index = new ImmutableRadixIndex(this.objects);
    this.preparedReferences = new AsyncLocalStorage();
  }

  async missingHead(error) {
    if (error.code !== "ENOENT") throw error;
    if (!this.allowCreate)
      throw immutableStorageError("Committed immutable session head is missing", error);
    try {
      await fsAccess(path.join(this.sessionDir, IMMUTABLE_SESSION_FORMAT_FILE));
    } catch (fenceError) {
      if (fenceError.code === "ENOENT")
        return { ...emptyHead(this.sessionId, this.format), ...this.objects.initialHeadFields() };
      throw fenceError;
    }
    throw immutableStorageError("Cannot recreate a switched session with a missing head", error);
  }

  async snapshot() {
    let handle;
    try {
      handle = await fsOpen(this.headPath, "r");
    } catch (error) {
      return this.missingHead(error);
    }
    const bytes = await readHeadBytes(handle);
    try {
      const head = decodeImmutableSessionHeadBytes(bytes, this.sessionId, this.format);
      this.allowCreate = false;
      return head;
    } catch (cause) {
      throw immutableStorageError("Cannot validate immutable session head", cause);
    }
  }

  async get(snapshot, collection, key) {
    entryKey(collection, key);
    return this.objects.withSnapshot(snapshot, async () => {
      const root = await this.index.get(snapshot.root, collection);
      const reference = await this.index.get(root, key);
      return reference === null ? null : this.objects.readValue(reference);
    });
  }

  async getMany(snapshot, collection, keys) {
    return this.readCollectionMany(snapshot, collection, keys, false);
  }

  async getManyMetadata(snapshot, collection, keys) {
    return this.readCollectionMany(snapshot, collection, keys, true);
  }

  async readCollectionMany(snapshot, collection, keys, metadata) {
    if (!Array.isArray(keys)) throw new TypeError("Immutable batch lookup requires keys");
    for (const key of keys) entryKey(collection, key);
    if (!keys.length) return new Map();
    return this.objects.withSnapshot(snapshot, async () => {
      const root = await this.index.get(snapshot.root, collection);
      const references = await this.index.getMany(root, keys);
      const selected = [...references].filter(([, reference]) => reference !== null);
      const records = selected.map(([, reference]) => reference);
      const decoded = metadata
        ? await this.objects.readValuesMetadata(records)
        : await this.objects.readValues(records);
      const values = new Map();
      let position = 0;
      for (const [key, reference] of references)
        values.set(key, reference === null ? null : decoded[position++]);
      return values;
    });
  }

  async readCommitReference(snapshot, generation) {
    if (!Number.isSafeInteger(generation) || generation < 1 || generation > snapshot.generation)
      throw new TypeError("Commit lookup requires a generation within its pinned snapshot");
    return this.objects.withSnapshot(snapshot, async () => {
      const root = await this.index.get(snapshot.root, "commitOrder");
      return this.index.get(root, immutableOrderKey(generation));
    });
  }

  async readCommitRecord(reference, generation) {
    this.requireReference(reference);
    return requireImmutableCommitRecord(
      await this.objects.readValue(reference),
      generation,
      this.requireReference,
    );
  }

  async readCommitChanges(snapshot, options) {
    return this.objects.withSnapshot(snapshot, () =>
      this.readSnapshotCommitChanges(snapshot, options),
    );
  }

  async readSnapshotCommitChanges(snapshot, { generation, collections }) {
    if (!Number.isSafeInteger(generation) || generation < 1 || generation > snapshot.generation)
      throw new TypeError("Commit query requires a generation within its pinned snapshot");
    if (
      !Array.isArray(collections) ||
      !collections.length ||
      collections.some(
        (collection) => !COLLECTIONS.has(collection) || collection === "commitOrder",
      ) ||
      new Set(collections).size !== collections.length
    )
      throw new TypeError("Commit query requires unique business collections");
    const reference = await this.readCommitReference(snapshot, generation);
    if (reference === null)
      throw immutableStorageError("Session commit generation is missing from its index");
    if (generation === snapshot.generation && reference !== snapshot.commit)
      throw immutableStorageError("Session commit index disagrees with its pinned head");
    const record = await this.readCommitRecord(reference, generation);
    const selected = new Set(collections);
    const mutations = record.mutations.filter(({ collection }) => selected.has(collection));
    const values = await this.objects.readValues(
      mutations.filter(({ reference }) => reference !== null).map(({ reference }) => reference),
    );
    let position = 0;
    const changes = [];
    for (const mutation of mutations) {
      const { collection, key } = mutation;
      changes.push(
        mutation.reference === null
          ? { collection, key, remove: true }
          : { collection, key, value: values[position++] },
      );
    }
    return { generation, operationId: record.operationId, changes };
  }

  async *entries(snapshot, collection, { metadata = false } = {}) {
    if (!COLLECTIONS.has(collection)) throw new TypeError("Invalid immutable session collection");
    const scoped = (operation) => this.objects.withSnapshot(snapshot, operation);
    const root = await scoped(() => this.index.get(snapshot.root, collection));
    const entries = this.index.entries(root);
    try {
      for (
        let selected = await readEntryBatch(entries, scoped);
        selected.length;
        selected = await readEntryBatch(entries, scoped)
      ) {
        const references = selected.map(([, reference]) => reference);
        const values = await scoped(() =>
          metadata
            ? this.objects.readValuesMetadata(references)
            : this.objects.readValues(references),
        );
        yield* selected.map(([key], slot) => [key, values[slot]]);
      }
    } finally {
      await scoped(() => entries.return());
    }
  }

  async transact({
    expectedGeneration,
    operationId,
    input,
    prepare,
    validate,
    validateSnapshot,
    projectResult,
  }) {
    requireImmutableOperationId(operationId);
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      !isFunction(prepare) ||
      (validate !== undefined && !isFunction(validate)) ||
      (validateSnapshot !== undefined && !isFunction(validateSnapshot)) ||
      (projectResult !== undefined && !isFunction(projectResult))
    )
      throw new TypeError("Immutable session transaction requires generation and prepare");
    const detachedInput = JSON.parse(JSON.stringify(input));
    const digest = immutableTransactionInputDigest(expectedGeneration, detachedInput);
    return sessionMutationCoordinator.run(this.lockPath, () =>
      this.preparedReferences.run(new Map(), () =>
        this.objects.withDurabilityBatch(async () => {
          const previous = await this.snapshot();
          this.objects.beginCommit(previous);
          const collectionRoots = new Map();
          const read = async (collection, key, metadata) => {
            entryKey(collection, key);
            if (!collectionRoots.has(collection))
              collectionRoots.set(collection, this.index.get(previous.root, collection));
            const reference = await this.index.get(await collectionRoots.get(collection), key);
            if (reference === null) return null;
            return metadata
              ? this.objects.readValueMetadata(reference)
              : this.objects.readValue(reference);
          };
          if (validateSnapshot)
            await validateSnapshot({
              input: detachedInput,
              snapshot: Object.freeze({ ...previous }),
              get: (collection, key) => read(collection, key, false),
            });
          const replay = await this.readOperation(previous, operationId, digest);
          if (replay) return projectResult ? projectResult(replay) : replay;
          this.assertGeneration(previous, expectedGeneration);
          const prepared = await prepare({
            snapshot: Object.freeze({ ...previous }),
            input: detachedInput,
            get: (collection, key) => read(collection, key, false),
            getMany: (collection, keys) => this.getMany(previous, collection, keys),
            getManyMetadata: (collection, keys) => this.getManyMetadata(previous, collection, keys),
            getMetadata: (collection, key) => read(collection, key, true),
          });
          const changes = this.detachChanges(prepared.changes, { allowReferences: true });
          const result = JSON.parse(JSON.stringify(prepared.result ?? null));
          if (prepared.abort === true) {
            if (changes.length)
              throw new TypeError("Aborted immutable transaction cannot contain changes");
            const aborted = {
              generation: previous.generation,
              commit: previous.commit,
              replayed: false,
              aborted: true,
              result,
            };
            return projectResult ? projectResult(aborted) : aborted;
          }
          const committed = await this.commitLocked({
            previous,
            operationId,
            changes,
            digest,
            result,
            validate,
            collectionRoots: new Map(collectionRoots),
          });
          return projectResult ? projectResult(committed) : committed;
        }),
      ),
    );
  }

  detachChanges(changes, { allowReferences = false } = {}) {
    if (!Array.isArray(changes)) throw new TypeError("Immutable session changes must be an array");
    const detached = JSON.parse(JSON.stringify(changes));
    const seen = new Set();
    for (const change of detached) {
      const key = entryKey(change.collection, change.key);
      requireImmutableSessionChange(change, this.requireReference);
      if (seen.has(key)) throw new TypeError("Invalid or duplicate immutable session change");
      if (
        Object.hasOwn(change, "reference") &&
        (!allowReferences || !this.preparedReferences.getStore()?.get(change.reference)?.has(key))
      )
        throw new TypeError(
          "Encoded change reference does not belong to this transaction and entity",
        );
      seen.add(key);
      if (!Object.hasOwn(change, "parts")) continue;
      if (change.remove === true) throw new TypeError("Removed values cannot reuse content");
      requireImmutableContentReuse(
        change.value,
        change.parts,
        immutableValueContentPaths(change.collection),
        this.requireReference,
      );
    }
    return detached;
  }

  async commit({ expectedGeneration, operationId, changes }) {
    requireImmutableOperationId(operationId);
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      !Array.isArray(changes)
    )
      throw new TypeError("Immutable session commit requires generation and changes");
    const detached = this.detachChanges(changes);
    const digest = contentDigest(JSON.stringify({ expectedGeneration, changes: detached }));
    return sessionMutationCoordinator.run(this.lockPath, () =>
      this.objects.withDurabilityBatch(async () => {
        const previous = await this.snapshot();
        this.objects.beginCommit(previous);
        const replay = await this.readOperation(previous, operationId, digest);
        if (replay) return replay;
        this.assertGeneration(previous, expectedGeneration);
        return this.commitLocked({ previous, operationId, changes: detached, digest });
      }),
    );
  }

  async putCollectionValue(collection, key, value, parts = []) {
    entryKey(collection, key);
    const reference = await this.objects.putValue(value, {
      parts,
      contentPaths: immutableValueContentPaths(collection),
      references: immutableCollectionValueReferences(collection, key, value, this.requireReference),
    });
    const prepared = this.preparedReferences.getStore();
    if (prepared) {
      if (!prepared.has(reference)) prepared.set(reference, new Set());
      prepared.get(reference).add(entryKey(collection, key));
    }
    return reference;
  }

  async readOperation(previous, operationId, digest) {
    const operationRef = await this.index.get(previous.operations, operationId);
    if (operationRef !== null) {
      const receipt = await this.objects.readValue(operationRef);
      requireImmutableOperationReceipt(receipt, previous.generation, this.requireReference);
      const commit = await this.readCommitRecord(receipt.commit, receipt.generation);
      if (
        commit.operationId !== operationId ||
        (await this.readCommitReference(previous, receipt.generation)) !== receipt.commit ||
        (receipt.generation === previous.generation && receipt.commit !== previous.commit)
      )
        throw immutableStorageError("Immutable operation receipt commit identity mismatch");
      assertImmutableOperationRetryAvailable(receipt, operationId);
      if (receipt.digest !== digest)
        throw Object.assign(new Error("operationId reused with different changes"), {
          code: "SESSION_OPERATION_CONFLICT",
        });
      await syncStorageDirectory(this.sessionDir);
      return {
        generation: receipt.generation,
        commit: receipt.commit,
        replayed: true,
        ...(Object.hasOwn(receipt, "result") ? { result: receipt.result } : {}),
      };
    }
    return null;
  }

  assertGeneration(previous, expectedGeneration) {
    if (previous.generation !== expectedGeneration)
      throw Object.assign(new Error("Immutable session generation conflict"), {
        code: "SESSION_GENERATION_CONFLICT",
        currentGeneration: previous.generation,
      });
    if (!Number.isSafeInteger(previous.generation + 1))
      throw new RangeError("Session generation overflow");
  }

  async prepareChangeReference(change) {
    if (change.remove === true) return null;
    if (Object.hasOwn(change, "reference")) return change.reference;
    return this.putCollectionValue(change.collection, change.key, change.value, change.parts);
  }

  async commitLocked({
    previous,
    operationId,
    changes,
    digest,
    result,
    validate,
    collectionRoots = new Map(),
  }) {
    const mutations = [];
    if (previous.generation === 0) {
      await fsMkdir(this.sessionDir, { recursive: true });
      await syncStorageDirectory(path.dirname(this.sessionDir));
      changes = this.detachChanges(
        [
          ...changes,
          {
            collection: "metadata",
            key: "commitIndex",
            value: { version: IMMUTABLE_COMMIT_INDEX_VERSION },
          },
        ],
        { allowReferences: true },
      );
    }
    for (const change of changes) {
      const reference = await this.prepareChangeReference(change);
      mutations.push({ collection: change.collection, key: change.key, reference });
    }
    const generation = previous.generation + 1;
    const record = { generation, operationId, previous: previous.commit, mutations };
    const commit = await this.objects.putValue(record, {
      references: immutableCommitReferences(record, this.requireReference),
    });
    const root = await buildImmutableCommitRoot({
      index: this.index,
      objects: this.objects,
      previousRoot: previous.root,
      generation,
      commit,
      mutations,
      collectionRoots,
    });
    const outcome = result === undefined ? {} : { result };
    const operationReceipt = { generation, commit, digest, ...outcome };
    const receipt = await this.objects.putValue(operationReceipt, {
      references: immutableOperationReceiptReferences(operationReceipt, this.requireReference),
    });
    const operations = await this.index.set(previous.operations, operationId, receipt);
    const head = {
      format: this.format,
      sessionId: this.sessionId,
      generation,
      root,
      operations,
      commit,
    };
    await this.objects.publishReachable([root, operations, commit]);
    Object.assign(head, this.objects.publicationHeadFields());

    if (validate) await this.objects.withSnapshot(head, () => validate(Object.freeze({ ...head })));
    const bytes = encodeHead(head, this.format);
    try {
      await writeDurableReplacement(this.headPath, bytes);
    } catch (cause) {
      throw Object.assign(
        new Error("Session commit outcome requires retry with the same operationId", { cause }),
        {
          code: "SESSION_COMMIT_UNCERTAIN",
          operationId,
        },
      );
    }
    recordStorageWork("immutableHeadWriteBytes", bytes.length);
    this.allowCreate = false;
    return { generation, commit, replayed: false, ...outcome };
  }
}
