/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { fsOpen, fsLstat, fsRm } from "../../shared/storage/fs-adapter.js";
import { resolveSessionArtifactMutationLock } from "../session-artifact-files.js";
import {
  IMMUTABLE_CURRENT_SESSION_FORMAT,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT,
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_DIRECTORIES,
  decodeImmutableSessionHeadBytes,
  encodeImmutableSessionHead,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
import {
  IMMUTABLE_SEGMENT,
  requireImmutableRecordReference,
} from "@noobot/session-protocol/immutable-segment";
import {
  immutablePageReferencePaths,
  immutableCommitReferenceEdges,
  immutableOperationReceiptReferenceEdges,
  requireImmutableOperationReceipt,
  immutableCollectionValueReferenceEdges,
  requireImmutableValueParts,
  isImmutableValuePartsPage,
  migrateImmutableMessageResult,
  IMMUTABLE_COMMIT_INDEX_VERSION,
  IMMUTABLE_WRAPPED_COMMIT_INDEX_VERSIONS,
  requireImmutableWrappedCommitReference,
  IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS,
  createImmutableCommitOrigin,
} from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableValueStore } from "./immutable-value-store.js";
import { ImmutableSegmentStore } from "./immutable-segment-store.js";
import { ImmutableRecordStore } from "./immutable-record-store.js";
import { ImmutableLocatedRecordStore } from "./immutable-located-record-store.js";
import { ImmutableLocatedMigrationWriter } from "./immutable-located-migration-writer.js";
import { immutableOfflineBackend } from "./immutable-storage-backends.js";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { auditImmutableSnapshot } from "./immutable-session-audit.js";
import { readImmutableReaderRetentions } from "./immutable-reader-retention.js";
import { writeDurableReplacement, syncStorageDirectory } from "./immutable-storage-io.js";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import {
  needsCheckpointReceiptMigration,
  migrateCheckpointReceipts,
} from "./immutable-checkpoint-receipt-migration.js";
import { wrappedImmutableCommitIndex } from "./immutable-wrapped-commit-migration.js";
import { ImmutableRadixIndex } from "./immutable-radix-index.js";

class MigrationWriter extends ImmutableValueStore {
  constructor(sessionDir) {
    super();
    this.segments = new ImmutableSegmentStore(sessionDir);
    this.batch = this.segments.createBatch();
    this.queue = Promise.resolve();
  }

  requireReference(reference) {
    return requireImmutableRecordReference(reference);
  }

  linkReferences() {}

  put(bytes) {
    const operation = this.queue.then(async () => {
      if (this.batch.bytes + bytes.length > IMMUTABLE_SEGMENT.bytes) await this.flush();
      return this.batch.stage(bytes);
    });
    this.queue = operation;
    return operation;
  }

  putPage(page) {
    return this.put(Buffer.from(JSON.stringify(page)));
  }

  async flush() {
    if (!this.batch.records.size) return;
    await this.batch.publish([...this.batch.records.keys()]);
    this.batch = this.segments.createBatch();
  }

  async finish() {
    await this.queue;
    await this.flush();
  }

  release() {
    this.batch.release();
  }
}

function replaceAt(value, fieldPath, reference) {
  if (!fieldPath.length) return reference;
  let owner = value;
  for (const field of fieldPath.slice(0, -1)) owner = owner[field];
  owner[fieldPath.at(-1)] = reference;
  return value;
}

function applyCommitOrigins(origins, mutations, generation) {
  for (const mutation of mutations) {
    const target = IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS[mutation.collection];
    if (!target) continue;
    if (mutation.reference === null) origins.get(target).delete(mutation.key);
    else origins.get(target).set(mutation.key, generation);
  }
}

async function hasSourceObjectDirectory(sessionDir) {
  try {
    await fsLstat(path.join(sessionDir, IMMUTABLE_SESSION_DIRECTORIES.objects));
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
}

class GraphTranslation {
  constructor({ source, writer, signal, reuseReferences, readOperationInput, rewriteCommitIndex }) {
    this.source = source;
    this.writer = writer;
    this.signal = signal;
    this.translated = new Map();
    this.reuseReferences = reuseReferences;
    this.readOperationInput = readOperationInput;
    this.rewriteCommitIndex = rewriteCommitIndex;
  }

  async copyRoot(head, commitIndex) {
    if (!this.rewriteCommitIndex) return this.copy(head.root, "index", "collections");

    const origins = new Map(
      Object.values(IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS).map((target) => [target, new Map()]),
    );
    for (let generation = 1; generation <= head.generation; generation += 1) {
      this.signal?.throwIfAborted();
      const reference = await commitIndex.readReference(this.source, head, generation);
      const record = await this.source.readCommitRecord(reference, generation);
      applyCommitOrigins(origins, record.mutations, generation);
    }
    const index = new ImmutableRadixIndex(this.writer);
    const collections = [];
    for await (const [collection, reference] of this.source.index.entries(head.root)) {
      if (!origins.has(collection))
        collections.push([collection, await this.copy(reference, "index", collection)]);
    }
    for (const [collection, members] of origins) {
      const entries = [];
      for (const [key, generation] of members)
        entries.push([key, await this.writer.putValue(createImmutableCommitOrigin(generation))]);
      if (entries.length) collections.push([collection, await index.setMany(null, entries)]);
    }
    return index.setMany(null, collections);
  }

  copy(reference, kind, collection, key) {
    this.signal?.throwIfAborted();
    if (reference === null) return Promise.resolve(null);
    if (
      this.reuseReferences &&
      kind !== "operation" &&
      !(kind === "index" && collection === "operations")
    )
      return Promise.resolve(reference);
    const identity = JSON.stringify([reference, kind, collection, key]);
    if (!this.translated.has(identity))
      this.translated.set(identity, this.translate(reference, kind, collection, key));
    return this.translated.get(identity);
  }

  async translate(reference, kind, collection, key) {
    if (this.rewriteCommitIndex && kind === "collection" && collection === "commitOrder") {
      const commit = requireImmutableWrappedCommitReference(
        await this.source.objects.readValue(reference),
        this.source.requireReference,
      );
      return this.copy(commit, "commit");
    }
    if (kind === "scalar") return this.translateScalar(reference);
    if (kind === "title") return this.translateTitle(reference);
    if (kind === "index") return this.translateIndex(reference, collection);
    return this.translateValue(reference, kind, collection, key);
  }

  async translateScalar(reference) {
    const page = await this.source.objects.readPage(reference);
    this.signal?.throwIfAborted();
    if (!isImmutableValuePartsPage(page))
      return this.writer.putValueChunks(
        this.source.objects.readValueChunks(reference, { rootPage: page, signal: this.signal }),
        { signal: this.signal },
      );
    requireImmutableValueParts(page, this.source.requireReference);
    const template = page.kind === "value-parts" ? await this.copy(page.template, "scalar") : null;
    const parts = [];
    for (const part of page.parts)
      parts.push({ path: part.path, reference: await this.copy(part.reference, "scalar") });
    return this.writer.putPage(
      page.kind === "value-parts-inline"
        ? { kind: page.kind, value: page.value, parts }
        : { kind: page.kind, template, parts },
    );
  }

  async translateTitle(reference) {
    const page = await this.source.objects.readPage(reference);
    for (const fieldPath of immutablePageReferencePaths(page, this.source.requireReference)) {
      const child = fieldPath.reduce((owner, field) => owner[field], page);
      replaceAt(page, fieldPath, await this.copy(child, "title"));
    }
    return this.writer.putPage(page);
  }

  indexEntryKind(collection) {
    if (collection === "operations") return "operation";
    if (collection === "scalar") return "scalar";
    return "collection";
  }

  async translateIndex(reference, collection) {
    const page = await this.source.objects.readPage(reference);
    if (page.kind === "index-branch") {
      for (const digit of Object.keys(page.children))
        page.children[digit] = await this.copy(page.children[digit], "index", collection);
    } else if (page.kind === "index-leaf") {
      for (const entry of page.entries) {
        const [entryKey, child] = entry;
        entry[1] =
          collection === "collections"
            ? await this.copy(child, "index", entryKey)
            : await this.copy(child, this.indexEntryKind(collection), collection, entryKey);
      }
    } else throw immutableStorageError("Migration encountered an invalid index page");
    return this.writer.putPage(page);
  }

  async translateValue(reference, kind, collection, key) {
    const metadata = await this.source.objects.readValueMetadata(reference);
    let value = metadata.value;
    if (
      this.rewriteCommitIndex &&
      kind === "collection" &&
      collection === "metadata" &&
      key === "commitIndex"
    ) {
      if (!IMMUTABLE_WRAPPED_COMMIT_INDEX_VERSIONS.includes(value?.version))
        throw immutableStorageError(
          "Wrapped commit migration encountered an unexpected historical index version",
        );
      value = { version: IMMUTABLE_COMMIT_INDEX_VERSION };
    }
    const parts = [];
    for (const part of metadata.parts)
      parts.push({ path: part.path, reference: await this.copy(part.reference, "scalar") });
    let edges = [];
    if (kind === "commit")
      edges = immutableCommitReferenceEdges(value, this.source.requireReference);
    else if (kind === "operation") {
      edges = immutableOperationReceiptReferenceEdges(value, this.source.requireReference);
      value = await migrateCheckpointReceipts({
        source: this.source,
        receipt: value,
        operationId: key,
        readOperationInput: this.readOperationInput,
        signal: this.signal,
      });
      value = await this.translateMessageReceipt(value, key);
    } else if (kind === "collection")
      edges = immutableCollectionValueReferenceEdges(
        collection,
        key,
        value,
        this.source.requireReference,
      );
    for (const edge of edges) {
      const translated = await this.copy(
        edge.reference,
        edge.role === "title" ? "title" : edge.kind,
        edge.kind === "index" ? edge.role : edge.collection,
        edge.key,
      );
      value = replaceAt(value, edge.path, translated);
    }
    return this.writer.putValue(value, {
      parts,
      contentPaths: metadata.parts.map((part) => part.path),
    });
  }

  async translateMessageReceipt(value, key) {
    if (value.retryUnavailable) return value;
    if (!value.result || !Object.hasOwn(value.result, "messages")) return value;
    const record = await this.source.readCommitRecord(value.commit, value.generation);
    if (record.operationId !== key)
      throw immutableStorageError("Message receipt migration commit ownership mismatch");
    const messages = migrateImmutableMessageResult(
      value.result.messages,
      this.source.sessionId,
      record.mutations,
    );
    const references = new Map(
      record.mutations
        .filter((mutation) => mutation.collection === "messages")
        .map((mutation) => [mutation.key, mutation.reference]),
    );
    for (const uid of new Set(messages)) {
      this.signal?.throwIfAborted();
      const { value: committed } = await this.source.objects.readValueMetadata(references.get(uid));
      if (
        committed?.message?.messageUid !== uid ||
        committed.message.sessionId !== this.source.sessionId
      )
        throw immutableStorageError("Message receipt migration entity ownership mismatch");
    }
    value = {
      ...value,
      result: {
        ...value.result,
        messages,
      },
    };
    return value;
  }
}

async function retireObjectDirectory(sessionDir, signal) {
  signal?.throwIfAborted();
  const directory = path.join(sessionDir, IMMUTABLE_SESSION_DIRECTORIES.objects);
  let state;
  try {
    state = await fsLstat(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (state && !state.isDirectory())
    throw immutableStorageError("Migration source objects must be a directory");

  await syncStorageDirectory(sessionDir);
  signal?.throwIfAborted();
  if (state) await fsRm(directory, { recursive: true });

  await syncStorageDirectory(sessionDir);
}

async function needsMessageReceiptMigration(source, head, signal) {
  return source.objects.withSnapshot(head, async () => {
    for await (const [, reference] of source.index.entries(head.operations)) {
      signal?.throwIfAborted();
      const { result, retryUnavailable } = requireImmutableOperationReceipt(
        await source.objects.readValue(reference),
        head.generation,
        source.requireReference,
      );
      if (retryUnavailable) continue;
      if (needsCheckpointReceiptMigration(result)) return true;
      if (
        result &&
        Object.hasOwn(result, "messages") &&
        (!Array.isArray(result.messages) || result.messages.some((uid) => typeof uid !== "string"))
      )
        return true;
    }
    return false;
  });
}

export async function migrateImmutableSessionSegments({
  sessionDir,
  signal,
  targetFormat = IMMUTABLE_CURRENT_SESSION_FORMAT,
  migrateMessageReceipts = false,
  readOperationInput,
}) {
  if (
    ![IMMUTABLE_SEGMENT_SESSION_FORMAT, ImmutableLocatedRecordStore.format].includes(targetFormat)
  )
    throw new TypeError("Unsupported migration target format");
  return sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), () =>
    migrateSegmentsLocked({
      sessionDir,
      signal,
      targetFormat,
      migrateMessageReceipts,
      readOperationInput,
    }),
  );
}

async function migrateSegmentsLocked({
  sessionDir,
  signal,
  targetFormat,
  migrateMessageReceipts,
  readOperationInput,
}) {
  signal?.throwIfAborted();

  const head = decodeImmutableSessionHeadBytes(
    await readFilePrefix(
      path.join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE),
      LENGTH_THRESHOLDS.immutableStorage.headBytes + 1,
      fsOpen,
    ),
  );
  if (head.format === ImmutableLocatedRecordStore.format && head.format !== targetFormat)
    throw immutableStorageError("Storage format downgrade is not supported");
  const source = new ImmutableSessionStore({
    sessionDir,
    sessionId: head.sessionId,
    objectStore: immutableOfflineBackend(head.format),
  });
  const rewriteReceipts =
    migrateMessageReceipts && (await needsMessageReceiptMigration(source, head, signal));
  const indexHeader = await source.get(head, "metadata", "commitIndex");
  const rewriteCommitIndex = IMMUTABLE_WRAPPED_COMMIT_INDEX_VERSIONS.includes(indexHeader?.version);
  if (head.format === targetFormat && !rewriteReceipts && !rewriteCommitIndex) {
    const sourcePresent = await hasSourceObjectDirectory(sessionDir);
    if (!sourcePresent) {
      await syncStorageDirectory(sessionDir);
      return {
        sessionDir: path.resolve(sessionDir),
        generation: head.generation,
        format: head.format,
      };
    }
  }
  const retainedSnapshots = await readImmutableReaderRetentions(source, head, signal);
  if (retainedSnapshots.length)
    throw Object.assign(new Error("Release retained readers before offline storage migration"), {
      code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
    });
  const before = await auditImmutableSnapshot({
    store: source,
    snapshot: head,
    signal,
    ...(rewriteCommitIndex
      ? { commitIndex: wrappedImmutableCommitIndex(indexHeader.version) }
      : {}),
  });
  if (!before.ok)
    throw Object.assign(immutableStorageError("Migration source failed integrity audit"), {
      report: before,
    });
  if (
    head.format === IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT &&
    targetFormat === IMMUTABLE_SEGMENT_SESSION_FORMAT &&
    !rewriteReceipts &&
    !rewriteCommitIndex
  ) {
    const migrated = { ...head, format: IMMUTABLE_SEGMENT_SESSION_FORMAT, segmentTail: null };
    await writeDurableReplacement(
      source.headPath,
      Buffer.from(encodeImmutableSessionHead(migrated, migrated.format)),
    );
    await retireObjectDirectory(sessionDir, signal);
    return {
      sessionDir: path.resolve(sessionDir),
      generation: head.generation,
      format: migrated.format,
    };
  }
  if (head.format === targetFormat && !rewriteReceipts && !rewriteCommitIndex) {
    await retireObjectDirectory(sessionDir, signal);
    return {
      sessionDir: path.resolve(sessionDir),
      generation: head.generation,
      format: head.format,
    };
  }
  return translateSnapshot({
    source,
    head,
    sessionDir,
    signal,
    targetFormat,
    rewriteCommitIndex,
    indexHeader,
    readOperationInput,
  });
}

async function translateSnapshot({
  source,
  head,
  sessionDir,
  signal,
  targetFormat,
  rewriteCommitIndex,
  indexHeader,
  readOperationInput,
}) {
  const writer =
    targetFormat === ImmutableLocatedRecordStore.format
      ? new ImmutableLocatedMigrationWriter(sessionDir, head)
      : new MigrationWriter(sessionDir);
  try {
    return await source.objects.withSnapshot(head, async () => {
      const translation = new GraphTranslation({
        source,
        writer,
        signal,
        reuseReferences:
          !rewriteCommitIndex &&
          head.format === targetFormat &&
          targetFormat === ImmutableLocatedRecordStore.format,
        readOperationInput,
        rewriteCommitIndex,
      });
      const root = await translation.copyRoot(
        head,
        rewriteCommitIndex ? wrappedImmutableCommitIndex(indexHeader.version) : undefined,
      );
      const operations = await translation.copy(head.operations, "index", "operations");
      const commit = await translation.copy(head.commit, "commit");
      const physicalFields = await writer.finish();
      const migrated = {
        ...head,
        format: targetFormat,
        segmentTail: null,
        ...physicalFields,
        root,
        operations,
        commit,
      };
      const target = new ImmutableSessionStore({
        sessionDir,
        sessionId: head.sessionId,
        objectStore:
          targetFormat === ImmutableLocatedRecordStore.format
            ? ImmutableLocatedRecordStore
            : ImmutableRecordStore,
      });
      const verified = await auditImmutableSnapshot({
        store: target,
        snapshot: migrated,
        signal,
      });
      if (!verified.ok)
        throw Object.assign(
          immutableStorageError("Translated segment graph failed integrity audit"),
          { report: verified },
        );
      signal?.throwIfAborted();
      await writeDurableReplacement(
        source.headPath,
        Buffer.from(encodeImmutableSessionHead(migrated, migrated.format)),
      );
      await retireObjectDirectory(sessionDir, signal);
      return {
        sessionDir: path.resolve(sessionDir),
        generation: migrated.generation,
        format: migrated.format,
      };
    });
  } finally {
    writer.release();
  }
}
