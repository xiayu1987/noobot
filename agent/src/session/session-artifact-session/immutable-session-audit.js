/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { contentDigest } from "./immutable-object-store.js";
import { verifyImmutableArtifactEventIndex } from "./immutable-artifact-event-index.js";
import { setImmediate } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { ImmutableSessionStore } from "./immutable-session-store.js";
import { readImmutableTitleNode } from "./immutable-title-index.js";
import { immutableCommitIndex } from "./immutable-commit-roots.js";
import { verifyImmutableHistoryRoots } from "./immutable-history-retention.js";
import {
  withImmutableAuditRetention,
  readImmutableReaderRetentions,
} from "./immutable-reader-retention.js";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import {
  requireImmutableCollection,
  requireImmutableStoredContent,
  immutableStorageError,
  requireImmutableMaintenanceLimit,
  requireImmutableSessionHead,
  requireImmutableRetainedSnapshot,
} from "@noobot/session-protocol/immutable-storage";
import {
  immutableValueIndexReferences,
  createImmutableCommitOrigin,
  requireImmutableOperationReceipt,
} from "@noobot/session-protocol/immutable-storage-graph";

class ImmutableGraphAudit {
  constructor(
    store,
    snapshot,
    { signal, validatedContent = new Set(), commitIndex = immutableCommitIndex },
  ) {
    this.store = store;
    this.snapshot = snapshot;
    this.commitIndex = commitIndex;
    this.signal = signal;
    this.visited = new Set();
    this.validatedContent = validatedContent;
    this.visitedIndexes = new Map();
    this.visitedTitles = new Set();
    this.currentEntries = new Map();
    this.checkedMutations = new Set();
    this.checkedValues = 0;
    this.checkedIndexes = 0;
    this.checkedCommits = 0;
    this.location = { kind: "head" };
  }

  async step(location) {
    this.signal?.throwIfAborted();
    this.location = location;
    this.checkedValues += 1;
  }

  async readValidatedTemplate(reference) {
    const { value, parts } = await this.store.objects.readValueMetadata(reference);
    for (const part of parts) {
      if (this.validatedContent.has(part.reference)) continue;

      await this.readValidatedTemplate(part.reference);
      this.validatedContent.add(part.reference);
    }
    return value;
  }

  async value(reference, collection, key) {
    this.store.requireReference(reference);
    const identity = JSON.stringify([reference, collection, key]);
    if (this.visited.has(identity)) return;
    this.visited.add(identity);
    await this.step({ kind: "value", reference, collection, key });
    const value = await this.readValidatedTemplate(reference);
    if (collection === "scalar") return;
    for (const child of immutableValueIndexReferences(
      collection,
      key,
      value,
      this.store.requireReference,
    )) {
      if (child.role === "title") await this.title(child.reference);
      else await this.index(child.reference, child.role, child.count);
    }
  }

  async title(reference, prefix = "") {
    if (reference === null) return;
    const identity = JSON.stringify([reference, prefix]);
    if (this.visitedTitles.has(identity)) return;
    this.visitedTitles.add(identity);
    await this.step({ kind: "title", reference, prefix });
    const node = await readImmutableTitleNode(this.store, reference, prefix);
    if (node.kind === "title-branch") {
      await this.title(node.zero, node.prefix + "0");
      await this.title(node.one, node.prefix + "1");
    }
  }

  async indexLeaf(entries, collection, current) {
    for (const [key, reference] of entries) {
      if (current) this.currentEntries.set(JSON.stringify([collection, key]), reference);
      await this.value(reference, collection, key);
    }
    return entries.length;
  }

  async indexPage(reference, collection, prefix = "", current = false) {
    this.signal?.throwIfAborted();
    if (reference === null) return 0;
    const identity = JSON.stringify([reference, collection, prefix, current]);
    if (this.visitedIndexes.has(identity)) return this.visitedIndexes.get(identity);
    this.checkedIndexes += 1;
    this.location = { kind: "index", reference, collection, prefix };
    const page = await this.store.index.readPage(reference, prefix);
    let count = 0;
    if (page.kind === "index-leaf") {
      count = await this.indexLeaf(page.entries, collection, current);
    } else {
      for (const [digit, child] of Object.entries(page.children))
        count += await this.indexPage(child, collection, prefix + digit, current);
    }
    this.visitedIndexes.set(identity, count);
    return count;
  }

  async index(reference, collection, expectedCount, current = false) {
    const count = await this.indexPage(reference, collection, "", current);
    if (expectedCount !== undefined && count !== expectedCount) {
      this.location = { kind: "index", reference, collection };
      throw immutableStorageError("Immutable index entry count mismatch");
    }
  }

  async current() {
    for await (const [collection, root] of this.store.index.entries(this.snapshot.root)) {
      requireImmutableCollection(collection);
      await this.index(
        root,
        collection,
        collection === "commitOrder" ? this.snapshot.generation : undefined,
        collection !== "commitOrder",
      );
    }
    this.artifactEventIndexPresent = this.currentEntries.has(
      JSON.stringify(["metadata", "artifactEventIndex"]),
    );
  }

  async verifyCommitOrigin(collection, key, reference, generation) {
    const identity = JSON.stringify([collection, key]);
    const current = this.currentEntries.get(identity);
    const actual = current === undefined ? null : await this.store.objects.readValue(current);
    const expected = reference === null ? null : createImmutableCommitOrigin(generation);
    this.location = { kind: "current-state", collection, key, generation };
    if (!isDeepStrictEqual(actual, expected))
      throw immutableStorageError("Commit origin disagrees with its latest committed mutation");
    this.currentEntries.delete(identity);
  }

  async verifyCurrentMutation(mutation, generation) {
    const { collection, key, reference } = mutation;

    if (
      collection === "commitOrder" ||
      Object.values(this.commitIndex.origins).includes(collection)
    )
      return;
    const identity = JSON.stringify([collection, key]);

    if (this.checkedMutations.has(identity)) return;
    this.checkedMutations.add(identity);
    this.location = { kind: "current-state", collection, key, generation, reference };
    if ((this.currentEntries.get(identity) ?? null) !== reference)
      throw immutableStorageError("Current index disagrees with its latest committed mutation");
    this.currentEntries.delete(identity);
    const origin = this.commitIndex.origins[collection];
    if (origin) await this.verifyCommitOrigin(origin, key, reference, generation);
  }

  async commitMutations(mutations, generation) {
    for (const mutation of mutations) {
      if (
        mutation.collection === "metadata" &&
        mutation.key === "artifactEventIndex" &&
        mutation.reference !== null &&
        !this.artifactEventIndexPresent
      )
        throw immutableStorageError("Committed artifact event index is missing from current state");
      await this.verifyCurrentMutation(mutation, generation);
      if (mutation.reference !== null)
        await this.value(mutation.reference, mutation.collection, mutation.key);
    }
  }

  async commits() {
    let reference = this.snapshot.commit;
    for (let generation = this.snapshot.generation; generation > 0; generation -= 1) {
      await this.step({ kind: "commit", reference, generation });
      const indexed = await this.commitIndex.readReference(this.store, this.snapshot, generation);
      if (indexed !== reference)
        throw immutableStorageError("Commit chain disagrees with its generation index");
      const record = await this.store.readCommitRecord(reference, generation);
      const operationReference = await this.store.index.get(
        this.snapshot.operations,
        record.operationId,
      );
      if (operationReference === null)
        throw immutableStorageError("Committed operation has no idempotency receipt");
      const receipt = requireImmutableOperationReceipt(
        await this.store.objects.readValue(operationReference),
        this.snapshot.generation,
        this.store.requireReference,
      );
      if (receipt.generation !== generation || receipt.commit !== reference)
        throw immutableStorageError("Committed operation receipt disagrees with its commit");
      await this.commitMutations(record.mutations, generation);
      this.checkedCommits += 1;
      reference = record.previous;
    }
    if (reference !== null)
      throw immutableStorageError("Commit chain does not terminate at its baseline");
    if (this.currentEntries.size) {
      const [identity, valueReference] = this.currentEntries.entries().next().value;
      const [collection, key] = JSON.parse(identity);
      this.location = { kind: "current-state", collection, key, reference: valueReference };
      throw immutableStorageError("Current index entry has no committed mutation");
    }
  }

  async operations() {
    let count = 0;
    for await (const [operationId, reference] of this.store.index.entries(
      this.snapshot.operations,
    )) {
      await this.step({ kind: "operation", reference, operationId });
      const receipt = requireImmutableOperationReceipt(
        await this.store.objects.readValue(reference),
        this.snapshot.generation,
        this.store.requireReference,
      );
      const commit = await this.store.readCommitRecord(receipt.commit, receipt.generation);
      if (
        commit.operationId !== operationId ||
        (await this.commitIndex.readReference(this.store, this.snapshot, receipt.generation)) !==
          receipt.commit
      )
        throw immutableStorageError("Operation index references a foreign commit");
      count += 1;
    }
    if (count !== this.snapshot.generation)
      throw immutableStorageError("Operation index count disagrees with the committed generation");
  }
}

export function auditImmutableSession(options) {
  return auditSessionInScope(options, withImmutableAuditRetention);
}

export function auditLockedImmutableSession(options) {
  return auditSessionInScope(options, (store, signal, run) =>
    sessionMutationCoordinator.run(store.lockPath, async () => {
      signal?.throwIfAborted();
      const head = await store.snapshot();
      const retainedSnapshots = await readImmutableReaderRetentions(store, head, signal);
      return run({ head, retainedSnapshots });
    }),
  );
}

async function auditSessionInScope(options, scope) {
  requireAuditOptions(options);
  try {
    const store = await ImmutableSessionStore.open({
      sessionDir: options.sessionDir,
      sessionId: options.sessionId,
      objectStore: options.objectStore,
    });
    return await scope(store, options.signal, ({ head, retainedSnapshots }) =>
      auditImmutableSnapshot({ ...options, store, snapshot: head, retainedSnapshots }),
    );
  } catch (error) {
    options.signal?.throwIfAborted();
    return auditFailure(error);
  }
}

function requireAuditOptions({ batchSize = 64, retainedObjects, maxObjectReads }) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1024)
    throw new TypeError("Immutable audit batchSize must be an integer in 1..1024");
  if (retainedObjects !== undefined && !(retainedObjects instanceof Set))
    throw new TypeError("Immutable audit retainedObjects must be a Set");
  if (maxObjectReads !== undefined)
    requireImmutableMaintenanceLimit("maxObjectReads", maxObjectReads);
}

function auditFailure(error, audit, objectReads = 0) {
  return {
    ok: false,
    complete: false,
    generation: audit?.snapshot.generation ?? null,
    checkedValues: audit?.checkedValues ?? 0,
    checkedIndexes: audit?.checkedIndexes ?? 0,
    checkedCommits: audit?.checkedCommits ?? 0,
    objectReads,
    issues: [
      {
        code: error.code ?? "SESSION_IMMUTABLE_STORAGE_INVALID",
        message: error.message,
        location: audit?.location ?? { kind: "head" },
      },
    ],
  };
}

function requireObjectOverrides(overrides, store) {
  if (overrides === undefined) return;
  if (!(overrides instanceof Map)) throw new TypeError("Object replacements require a Map");
  for (const [reference, bytes] of overrides) {
    if (!Buffer.isBuffer(bytes))
      throw immutableStorageError("Repair bytes do not match their immutable object identity");
    requireImmutableStoredContent(
      reference,
      { digest: contentDigest(bytes), length: bytes.length },
      store.format,
    );
  }
}

async function auditRetainedReaderRoots(
  store,
  snapshot,
  retainedSnapshots,
  { signal, validatedContent },
) {
  for (const retained of retainedSnapshots) {
    if (retained.generation === snapshot.generation) continue;
    await store.objects.withSnapshot(retained, async () => {
      const audit = new ImmutableGraphAudit(store, retained, { signal, validatedContent });
      await audit.current();
      await audit.index(retained.operations, "scalar", retained.generation);
    });
  }
}

export async function auditImmutableSnapshot({
  store: sourceStore,
  snapshot,
  batchSize = 64,
  signal,
  objectOverrides,
  retainedObjects,
  maxObjectReads,
  retainedSnapshots = [],
  commitIndex = immutableCommitIndex,
}) {
  requireAuditOptions({ batchSize, retainedObjects, maxObjectReads });

  const store = new ImmutableSessionStore({
    sessionDir: sourceStore.sessionDir,
    sessionId: sourceStore.sessionId,
    objectStore: sourceStore.objects.constructor,
  });
  let audit;
  let objectReads = 0;
  try {
    signal?.throwIfAborted();
    const usedOverrides = new Set();
    requireImmutableSessionHead(snapshot, store.sessionId, store.format);
    for (const retained of retainedSnapshots) requireImmutableRetainedSnapshot(retained, snapshot);
    requireObjectOverrides(objectOverrides, store);
    return await store.objects.withPhysicalRepairOverlay(
      { replacements: objectOverrides, used: usedOverrides, signal },
      async () => {
        for (const head of [snapshot, ...retainedSnapshots]) {
          signal?.throwIfAborted();
          await store.objects.validateSnapshot(head, objectOverrides);
        }

        const read = store.objects.read.bind(store.objects);
        store.objects.read = async (reference) => {
          signal?.throwIfAborted();
          if (objectReads === maxObjectReads)
            throw Object.assign(new Error("Immutable maintenance object read budget exhausted"), {
              code: "SESSION_MAINTENANCE_BUDGET_EXCEEDED",
            });
          objectReads += 1;
          let bytes;
          if (objectOverrides?.has(reference)) {
            usedOverrides.add(reference);
            bytes = objectOverrides.get(reference);
          } else bytes = await read(reference);
          retainedObjects?.add(reference);
          signal?.throwIfAborted();
          if (objectReads % batchSize === 0) await setImmediate(undefined, { signal });
          return bytes;
        };
        await store.objects.withSnapshot(snapshot, async () => {
          audit = new ImmutableGraphAudit(store, snapshot, { signal, commitIndex });
          await audit.current();
          if (await store.get(snapshot, "metadata", "artifactEventIndex")) {
            audit.location = { kind: "artifact-event-index" };
            await verifyImmutableArtifactEventIndex(store, snapshot);
          }
          await audit.commits();
          await audit.operations();
          await verifyImmutableHistoryRoots(store, snapshot, {
            signal,
            retainedSnapshots,
            commitIndex,
          });
        });
        await auditRetainedReaderRoots(store, snapshot, retainedSnapshots, {
          signal,
          validatedContent: audit.validatedContent,
        });
        if (objectOverrides && usedOverrides.size !== objectOverrides.size)
          throw immutableStorageError("Repair contains objects outside the committed graph");
        return {
          ok: true,
          complete: true,
          sessionId: snapshot.sessionId,
          generation: snapshot.generation,
          checkedValues: audit.checkedValues,
          checkedIndexes: audit.checkedIndexes,
          checkedCommits: audit.checkedCommits,
          objectReads,
          issues: [],
        };
      },
    );
  } catch (error) {
    signal?.throwIfAborted();
    return auditFailure(error, audit, objectReads);
  }
}
