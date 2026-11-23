/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isFunction } from "@noobot/shared/value";
import { filePath as path } from "@noobot/path-resolver";
import { withImmutableAuthorityMutation } from "../session-storage-authority.js";
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
import { recordStorageWork } from "../session-storage-observation.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { buildImmutableCommitRoot } from "./immutable-commit-roots.js";

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";

import {
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_FORMAT_FILE,
  encodeImmutableSessionHead,
  decodeImmutableSessionHeadBytes,
} from "@noobot/session-protocol/immutable-storage";

import {
  captureSessionTransactionInput,
  requireSessionOperationId,
} from "@noobot/session-protocol/session-changes";
import {
  IMMUTABLE_COMMIT_INDEX_VERSION,
  IMMUTABLE_VALUE_READ_BATCH_RECORDS,
  immutableTransactionInputDigest,
  immutableValueContentPaths,
  immutableCollectionValueReferences,
  immutableCommitReferences,
  immutableOperationReceiptReferences,
  requireImmutableCommitRecord,
  requireImmutableContentReuse,
  requireImmutableSessionChange,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  requireImmutableOperationReceipt,
  assertImmutableOperationRetryMatches,
} from "@noobot/session-protocol/immutable-operation-receipt";
import { SESSION_COLLECTION_NAMES } from "@noobot/session-protocol/session-collection-names";

const COLLECTIONS = new Set(SESSION_COLLECTION_NAMES);

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
    objectRead,
  }) {
    if (typeof sessionId !== "string" || !sessionId) throw new TypeError("sessionId is required");
    this.sessionDir = path.resolve(sessionDir);
    this.sessionId = sessionId;
    this.allowCreate = allowCreate;
    this.headPath = path.join(this.sessionDir, IMMUTABLE_SESSION_HEAD_FILE);
    this.lockPath = resolveSessionArtifactMutationLock(this.sessionDir);
    this.objects = new objectStore(this.sessionDir, objectRead);
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
    return this.readCollectionMany(snapshot, collection, keys, { metadata: false });
  }

  async getManyMetadata(snapshot, collection, keys, options) {
    return this.readCollectionMany(snapshot, collection, keys, { metadata: true, options });
  }

  readCollectionMany(snapshot, collection, keys, mode) {
    return this.objects.withSnapshot(snapshot, () =>
      this.#readCollectionMany(
        () => this.index.get(snapshot.root, collection),
        collection,
        keys,
        mode,
      ),
    );
  }

  async #readCollectionMany(resolveRoot, collection, keys, { metadata, options }) {
    if (!Array.isArray(keys)) throw new TypeError("Immutable batch lookup requires keys");
    for (const key of keys) entryKey(collection, key);
    if (!keys.length) return new Map();
    const references = await this.index.getMany(await resolveRoot(), keys);
    const records = [...references.values()].filter((reference) => reference !== null);
    const decoded = metadata
      ? await this.objects.readValuesMetadata(records, options)
      : await this.objects.readValues(records, options);
    const values = new Map();
    let position = 0;
    for (const [key, reference] of references)
      values.set(key, reference === null ? null : decoded[position++]);
    return values;
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
    const { record } = await this.#readIndexedCommit(snapshot, generation);
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

  async #readIndexedCommit(snapshot, generation) {
    const reference = await this.readCommitReference(snapshot, generation);
    return this.#readCommitAtReference(snapshot, generation, reference);
  }

  async #readCommitAtReference(snapshot, generation, reference) {
    if (reference === null)
      throw immutableStorageError("Session commit generation is missing from its index");
    if (generation === snapshot.generation && reference !== snapshot.commit)
      throw immutableStorageError("Session commit index disagrees with its pinned head");
    return { reference, record: await this.readCommitRecord(reference, generation) };
  }

  async #readMigrationWindow(snapshot, first, count) {
    const end = first + count;
    const keys = [];
    for (let generation = Math.max(1, first - 1); generation < end; generation += 1) {
      keys.push(immutableOrderKey(generation));
    }
    const root = await this.index.get(snapshot.root, "commitOrder");
    const references = await this.index.getMany(root, keys);
    const commits = [];
    for (let generation = first; generation < end; generation += 1) {
      const reference = references.get(immutableOrderKey(generation));
      const commit = await this.#readCommitAtReference(snapshot, generation, reference);
      const previous = generation === 1 ? null : references.get(immutableOrderKey(generation - 1));
      commits.push({ ...commit, previous });
    }
    const receipts = await this.index.getMany(
      snapshot.operations,
      commits.map(({ record }) => record.operationId),
    );
    return { commits, receipts };
  }

  async #readMigrationReceipt(snapshot, { reference, record, previous }, receiptReference) {
    const { generation } = record;
    if ((generation > 1 && previous === null) || record.previous !== previous)
      throw immutableStorageError("Commit chain disagrees with its generation index");
    const receipt = await this.#readOperationReceiptReference(snapshot, receiptReference);
    if (receipt === null || receipt.generation !== generation || receipt.commit !== reference)
      throw immutableStorageError("Immutable operation receipt commit identity mismatch");
    return { receipt, record };
  }

  async *migrationOperations(snapshot, signal) {
    for (let first = 1; first <= snapshot.generation; first += IMMUTABLE_VALUE_READ_BATCH_RECORDS) {
      signal?.throwIfAborted();
      const count = Math.min(IMMUTABLE_VALUE_READ_BATCH_RECORDS, snapshot.generation - first + 1);
      const { commits, receipts } = await this.objects.withSnapshot(snapshot, () =>
        this.#readMigrationWindow(snapshot, first, count),
      );
      for (const commit of commits) {
        signal?.throwIfAborted();
        yield await this.objects.withSnapshot(snapshot, () =>
          this.#readMigrationReceipt(snapshot, commit, receipts.get(commit.record.operationId)),
        );
      }
    }
  }

  async visitMigrationCommit(snapshot, generation, { visitOperation, visitChange }) {
    if (!Number.isSafeInteger(generation) || generation < 1 || generation > snapshot.generation)
      throw new TypeError("Commit lookup requires a generation within its pinned snapshot");
    return this.objects.withSnapshot(snapshot, async () => {
      const {
        commits: [commit],
        receipts,
      } = await this.#readMigrationWindow(snapshot, generation, 1);
      const { receipt, record } = await this.#readMigrationReceipt(
        snapshot,
        commit,
        receipts.get(commit.record.operationId),
      );
      await visitOperation({ receipt, record });
      for (const { collection, key, reference } of record.mutations) {
        if (collection === "commitOrder") continue;
        await visitChange(
          reference === null
            ? { collection, key, remove: true }
            : { collection, key, value: await this.objects.readValue(reference) },
        );
      }
    });
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
    validateInput,
    projectResult,
  }) {
    requireSessionOperationId(operationId);
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      !isFunction(prepare) ||
      (validate !== undefined && !isFunction(validate)) ||
      (validateSnapshot !== undefined && !isFunction(validateSnapshot)) ||
      (validateInput !== undefined && !isFunction(validateInput)) ||
      (projectResult !== undefined && !isFunction(projectResult))
    )
      throw new TypeError("Immutable session transaction requires generation and prepare");
    const capturedInput = captureSessionTransactionInput(input);
    return withImmutableAuthorityMutation(this.sessionDir, () =>
      this.preparedReferences.run(new Map(), () =>
        this.objects.withDurabilityBatch(async () => {
          const previous = await this.snapshot();
          this.objects.beginCommit(previous);
          const collectionRoots = new Map();
          const resolveRoot = (collection) => {
            if (!collectionRoots.has(collection))
              collectionRoots.set(collection, this.index.get(previous.root, collection));
            return collectionRoots.get(collection);
          };
          const readMany = (collection, keys, metadata) =>
            this.#readCollectionMany(() => resolveRoot(collection), collection, keys, { metadata });
          const read = async (collection, key, metadata) => {
            entryKey(collection, key);
            const reference = await this.index.get(await resolveRoot(collection), key);
            if (reference === null) return null;
            return metadata
              ? this.objects.readValueMetadata(reference)
              : this.objects.readValue(reference);
          };
          if (validateSnapshot)
            await validateSnapshot({
              snapshot: Object.freeze({ ...previous }),
              get: (collection, key) => read(collection, key, false),
            });
          if (validateInput) validateInput(capturedInput);
          const digest = immutableTransactionInputDigest(expectedGeneration, capturedInput);
          const replay = await this.#readOperation(previous, operationId, digest);
          if (replay) {
            const { outcome, record } = replay;
            return projectResult ? projectResult(outcome, previous, record) : outcome;
          }
          this.assertGeneration(previous, expectedGeneration);
          const prepared = await prepare({
            snapshot: Object.freeze({ ...previous }),
            input: capturedInput,
            get: (collection, key) => read(collection, key, false),
            getMany: (collection, keys) => readMany(collection, keys, false),
            getManyMetadata: (collection, keys) => readMany(collection, keys, true),
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
            return projectResult ? projectResult(aborted, previous, null) : aborted;
          }
          return this.#commitLocked({
            previous,
            operationId,
            changes,
            digest,
            result,
            validate,
            projectResult,
            collectionRoots: new Map(collectionRoots),
          });
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
    requireSessionOperationId(operationId);
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      !Array.isArray(changes)
    )
      throw new TypeError("Immutable session commit requires generation and changes");
    const detached = this.detachChanges(changes);
    const digest = contentDigest(JSON.stringify({ expectedGeneration, changes: detached }));
    return withImmutableAuthorityMutation(this.sessionDir, () =>
      this.objects.withDurabilityBatch(async () => {
        const previous = await this.snapshot();
        this.objects.beginCommit(previous);
        const replay = await this.#readOperation(previous, operationId, digest);
        if (replay) return replay.outcome;
        this.assertGeneration(previous, expectedGeneration);
        return this.#commitLocked({ previous, operationId, changes: detached, digest });
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

  async #readOperationReceipt(snapshot, operationId) {
    const operationRef = await this.index.get(snapshot.operations, operationId);
    return this.#readOperationReceiptReference(snapshot, operationRef);
  }

  async #readOperationReceiptReference(snapshot, operationRef) {
    if (operationRef === null) return null;
    const receipt = await this.objects.readValue(operationRef);
    return requireImmutableOperationReceipt(receipt, snapshot.generation, this.requireReference);
  }

  async readCommittedOperation(snapshot, operationId) {
    requireSessionOperationId(operationId);
    return this.objects.withSnapshot(snapshot, async () => {
      const receipt = await this.#readOperationReceipt(snapshot, operationId);
      if (receipt === null) return null;
      const record = await this.readCommitRecord(receipt.commit, receipt.generation);
      if (
        record.operationId !== operationId ||
        (await this.readCommitReference(snapshot, receipt.generation)) !== receipt.commit ||
        (receipt.generation === snapshot.generation && receipt.commit !== snapshot.commit)
      )
        throw immutableStorageError("Immutable operation receipt commit identity mismatch");
      return { receipt, record };
    });
  }

  async #readOperation(previous, operationId, digest) {
    const operation = await this.readCommittedOperation(previous, operationId);
    if (operation !== null) {
      const { receipt, record } = operation;
      assertImmutableOperationRetryMatches(receipt, operationId, digest);
      await syncStorageDirectory(this.sessionDir);
      return {
        record,
        outcome: {
          generation: receipt.generation,
          commit: receipt.commit,
          replayed: true,
          ...(Object.hasOwn(receipt, "result") ? { result: receipt.result } : {}),
        },
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

  async #commitLocked({
    previous,
    operationId,
    changes,
    digest,
    result,
    validate,
    projectResult,
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
    const committed = { generation, commit, replayed: false, ...outcome };

    const response = projectResult
      ? await projectResult(committed, Object.freeze({ ...previous, ...head }), record)
      : committed;
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
    return response;
  }
}
