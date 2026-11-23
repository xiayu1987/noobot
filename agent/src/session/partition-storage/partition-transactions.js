/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  capturePartitionTransactionRequest,
  createPartitionTransactionOutcome,
  partitionEntityKey,
  partitionMutationOwner,
  preparePartitionSessionCommitRequest,
  projectVisiblePartitionMutation,
  requirePartitionEntityOwner,
  requirePartitionEntityReference,
  samePartitionEntityOwner,
} from "@noobot/session-protocol/partition-transaction";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  createPartitionCollectionReadBudget,
  createPartitionCollectionSlotBudget,
  requirePartitionCollectionQuery,
  requireSessionCollectionQuery,
  requireSessionCollectionOwnerQuery,
  partitionCollectionResultBytes,
} from "@noobot/session-protocol/partition-collection-query";
import { attachPartitionCollectionPublication } from "./partition-collection-index.js";
import {
  finishPartitionCommitPhase,
  observePartitionCommitPhase,
  startPartitionCommitPhase,
} from "./partition-commit-observation.js";
import {
  visitPartitionCollectionKeys,
  lookupLocalEntities,
  lookupPartitionCreationEntries,
  lookupPartitionEntities,
  projectPartitionEntityUpdates,
} from "./partition-entity-directory.js";

function rejectOwner() {
  throw new PartitionAdmissionRejection(
    "SESSION_STORAGE_IDENTITY",
    "Entity owner does not match snapshot",
  );
}

function createCollectionReadState(snapshot, mutationCacheLimit) {
  const budget = createPartitionCollectionReadBudget(snapshot);
  return {
    budget,
    readWindow: budget.readWindow,
    mutations: new Map(),
    mutationCacheLimit,
    references: new Map(),
  };
}

function collectionQueryReads(snapshot, reads, consumeOperationBytes) {
  return {
    ...reads,
    budget: {
      consume: createPartitionCollectionReadBudget(snapshot, consumeOperationBytes).consume,
      frameScope: reads.budget,
      frameLimit: reads.mutationCacheLimit,
    },
  };
}

function validateMutation({ mutation, reference, collection, key, owner }) {
  if (!mutation || mutation.collection !== collection || mutation.key !== key)
    throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Entity reference identity mismatch");
  requirePartitionEntityOwner(owner, reference.record.sequence);
  const actual = partitionMutationOwner(mutation.owner, reference);
  if (!samePartitionEntityOwner(actual, owner))
    throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Entity reference owner mismatch");
  return mutation;
}

function requireQueryOwner(query, owner) {
  if (
    owner &&
    (owner.epoch !== query.snapshot.epoch ||
      owner.sequence > query.snapshot.sequence ||
      owner.partition > query.snapshot.tail.partition)
  )
    rejectOwner();
}

function requireResolvedOwners(owners, staged, entries) {
  if (!owners) return;
  for (const [key, owner] of owners) {
    const actual = (staged.get(key) ?? entries.get(key))?.owner;
    if (!actual || !samePartitionEntityOwner(actual, owner)) rejectOwner();
  }
}

function cacheCollectionRead(cache, key, entry, limit) {
  if (!cache) return;
  cache.set(key, entry);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
}

function selectRecordBatch(batch, { cache, cacheLimit, collection, select }) {
  for (const result of batch) {
    if (result.status === "rejected") throw result.reason;
    const { identity, record, entries, slots } = result.value;
    cacheCollectionRead(cache, identity, slots, cacheLimit);
    for (const [key, slot, owner] of entries) {
      const entry = slots.get(slot);
      validateMutation({
        mutation: entry?.mutation,
        reference: { record, slot },
        collection,
        key,
        owner,
      });
      select(key, entry, owner, Boolean(cache));
    }
  }
}

export class PartitionTransactions {
  constructor(journal) {
    this.journal = journal;
    attachPartitionCollectionPublication(journal);
  }

  async prepareRequest(snapshot, request) {
    return this.journal.withSnapshot(snapshot, () =>
      preparePartitionSessionCommitRequest(snapshot, request),
    );
  }

  async commit(request, callbacks) {
    const { identity, request: captured } = capturePartitionTransactionRequest(
      request,
      this.journal.head.limits,
    );
    const { validateScope, prepare, projectResult } = callbacks;
    if (!isFunction(validateScope) || !isFunction(prepare))
      throw partitionJournalError(
        "SESSION_PUBLICATION_CONTRACT",
        "Collection transactions require scope validation and preparation",
      );
    const { input } = captured;
    const readsBySnapshot = new WeakMap();
    const view = (snapshot, staged, reads, generation) => {
      const getLatestMany = (readState, { collection, keys }) =>
        this.#readLatest(
          requireSessionCollectionQuery({ snapshot, collection, keys }),
          staged,
          readState,
          true,
        );
      return Object.freeze({
        generation,
        pageRecords: snapshot.limits.pageRecords,
        readWindow: (length, readRecord) => {
          const page = createCollectionReadState(snapshot);
          return page.readWindow(length, (index) =>
            readRecord((query) => getLatestMany(page, query), index),
          );
        },
        getLatestMany: (query) => getLatestMany(collectionQueryReads(snapshot, reads), query),
        getCreationOwners: ({ collection, keys }) =>
          this.#readCreationOwners(
            requireSessionCollectionQuery({ snapshot, collection, keys }),
            staged,
            collectionQueryReads(snapshot, reads),
          ),
        getLatestByOwner: ({ collection, entities }) =>
          this.#readLatest(
            requireSessionCollectionOwnerQuery({ snapshot, collection, entities }),
            staged,
            collectionQueryReads(snapshot, reads),
            true,
          ),
      });
    };
    const receipt = await this.journal.appendTransaction(identity, {
      validateScope: async (snapshot) => {
        const reads = createCollectionReadState(snapshot, snapshot.limits.pageRecords);
        await validateScope(snapshot, view(snapshot, null, reads, snapshot.sequence), input);
        readsBySnapshot.set(snapshot, reads);
      },
      prepare: async (snapshot, stagedEntities, generation) => {
        const current = view(snapshot, stagedEntities, readsBySnapshot.get(snapshot), generation);
        return prepare(snapshot, current, input);
      },
    });
    return createPartitionTransactionOutcome(receipt, projectResult);
  }

  async readKeysByCollection(snapshot, collections) {
    const keys = new Map(collections.map((collection) => [collection, new Set()]));
    await this.visitCollectionKeys(snapshot, collections, (key, collection) => {
      keys.get(collection).add(key);
    });
    return keys;
  }

  async visitCollectionKeys(snapshot, collections, visit) {
    return this.journal.withSnapshot(snapshot, () =>
      visitPartitionCollectionKeys(this.journal, snapshot, collections, visit),
    );
  }

  async projectLatestUpdates() {
    return projectPartitionEntityUpdates(this.journal);
  }

  async lookupMany(input) {
    const query = requirePartitionCollectionQuery(input);
    return this.journal.withSnapshot(query.snapshot, async () => {
      const entries = await this.#lookupQuery(
        query,
        createPartitionCollectionReadBudget(query.snapshot),
      );
      let remainingBytes = query.snapshot.limits.pageBytes;
      const references = new Map();
      for (const [key, entry] of entries) {
        const reference = entry === null ? null : entry.reference;
        remainingBytes -= partitionCollectionResultBytes([key, reference], remainingBytes);
        references.set(key, reference);
      }
      return references;
    });
  }

  async #lookupQuery(query, readBudget) {
    if (!query.keys.length || query.snapshot.sequence === 0)
      return new Map(query.keys.map((key) => [key, null]));
    return lookupLocalEntities(this.journal, query, readBudget);
  }

  async getMany(input) {
    const query = requirePartitionCollectionQuery(input);
    return this.journal.withSnapshot(query.snapshot, async () => {
      const readBudget = createPartitionCollectionReadBudget(query.snapshot);
      const entries = await this.#lookupQuery(query, readBudget);
      return this.#readReferences({ query, directoryEntries: entries, readBudget });
    });
  }

  async lookupLatestMany(input) {
    const query = requireSessionCollectionQuery(input);
    return this.journal.withSnapshot(query.snapshot, async () => {
      const readBudget = createPartitionCollectionReadBudget(query.snapshot);
      const entries = await lookupPartitionEntities(this.journal, query, readBudget);
      let remainingBytes = query.snapshot.limits.pageBytes;
      for (const entry of entries)
        remainingBytes -= partitionCollectionResultBytes(entry, remainingBytes);
      return entries;
    });
  }

  async getLatestMany(input) {
    return this.#readLatest(requireSessionCollectionQuery(input), null);
  }

  async getLatestByOwner(input) {
    return this.#readLatest(requireSessionCollectionOwnerQuery(input), null);
  }

  async withCollectionReader(snapshot, operation, { consumeReadBytes } = {}) {
    return this.journal.withRecordReader(snapshot, () => {
      const reads = createCollectionReadState(snapshot);
      const read = async ({ collection, keys, includeOwner = false }) => {
        const query = requireSessionCollectionQuery({ snapshot, collection, keys });

        const queryReads = consumeReadBytes
          ? collectionQueryReads(snapshot, reads, consumeReadBytes)
          : reads;
        const entries = await this.#readLatest(query, null, queryReads, includeOwner);
        if (!includeOwner)
          for (const [key, mutation] of entries)
            entries.set(key, projectVisiblePartitionMutation(mutation));
        return entries;
      };
      return operation(
        consumeReadBytes ? read : Object.assign(read, { readWindow: reads.readWindow }),
      );
    });
  }

  async #resolveEntries(query, { stagedEntities, readBudget, references, lookup }) {
    const staged = new Map();
    const cached = new Map();
    const selectors = new Map();
    const creation = lookup === lookupPartitionCreationEntries;
    const keys = query.keys.filter((key) => {
      const entry = stagedEntities?.get(partitionEntityKey(query.collection, key));
      if (entry !== undefined) {
        staged.set(key, entry);
        return false;
      }
      const owner = query.owners?.get(key);
      requireQueryOwner(query, owner);
      if (!references) return true;
      const latest = JSON.stringify(["latest", query.collection, key]);
      const selector = creation ? JSON.stringify(["creation", query.collection, key]) : latest;
      if (references.has(selector)) {
        cached.set(key, references.get(selector));
        return false;
      }
      if (creation) {
        if (references.has(latest)) {
          cached.set(key, references.get(latest));
          return false;
        }
      }
      selectors.set(key, selector);
      return true;
    });
    const started = keys.length ? startPartitionCommitPhase() : undefined;
    const entries = keys.length
      ? await lookup(this.journal, { ...query, keys }, readBudget)
      : new Map();
    if (started !== undefined)
      finishPartitionCommitPhase(`resolveEntityDirectory:${query.collection}`, started);
    requireResolvedOwners(query.owners, staged, new Map([...entries, ...cached]));
    for (const [key, entry] of entries)
      cacheCollectionRead(references, selectors.get(key), entry, query.snapshot.limits.pageRecords);
    for (const [key, entry] of cached) entries.set(key, entry);
    return { entries, staged };
  }

  async #readCreationOwners(query, stagedEntities, reads) {
    return this.journal.withSnapshot(query.snapshot, async () => {
      const { entries, staged } = await this.#resolveEntries(query, {
        stagedEntities,
        readBudget: reads.budget,
        references: reads.references,
        lookup: lookupPartitionCreationEntries,
      });
      let remainingBytes = query.snapshot.limits.pageBytes;
      const owners = new Map();
      for (const key of query.keys) {
        const entry = staged.get(key) ?? entries.get(key);
        const owner = entry === null ? null : structuredClone(entry.owner);
        remainingBytes -= partitionCollectionResultBytes([key, owner], remainingBytes);
        owners.set(key, owner);
      }
      return owners;
    });
  }

  async #readLatest(query, stagedEntities, reads, includeOwner = false) {
    return this.journal.withSnapshot(query.snapshot, async () => {
      const readBudget = reads?.budget ?? createPartitionCollectionReadBudget(query.snapshot);
      const { entries, staged } = await this.#resolveEntries(query, {
        stagedEntities,
        readBudget,
        references: reads?.references,
        lookup: lookupPartitionEntities,
      });
      return this.#readReferences({
        query,
        directoryEntries: entries,
        readBudget,
        staged,
        cache: reads?.mutations,
        cacheLimit: reads?.mutationCacheLimit,
        includeOwner,
      });
    });
  }

  async #loadRecordSlots({ snapshot, record, entries, readBudget }, records) {
    const slots = [...new Set(entries.map(([, slot]) => slot))].filter(
      (slot) => !records.has(slot),
    );
    if (!slots.length) return;
    const loaded = await observePartitionCommitPhase("readEntityRecordSlots", () =>
      this.journal.readRecordSlots({ snapshot, reference: record, slots, readBudget }),
    );
    for (const entry of loaded) records.set(...entry);
  }

  async #readReferences({
    query,
    directoryEntries,
    readBudget,
    staged,
    cache,
    cacheLimit,
    includeOwner,
  }) {
    const { snapshot, collection } = query;
    const values = new Map();
    const transactions = new Map();
    const consumeSlotBytes = createPartitionCollectionSlotBudget(snapshot);
    const select = (key, { mutation, encodedBytes }, owner, clone) => {
      consumeSlotBytes(encodedBytes);
      const value = clone ? structuredClone(mutation) : mutation;
      values.set(key, includeOwner ? { owner: structuredClone(owner), mutation: value } : value);
    };
    for (const [key, entry] of staged ?? []) select(key, entry, entry.owner, true);
    for (const [key, entry] of directoryEntries) {
      if (entry === null) {
        values.set(key, null);
        continue;
      }
      const { reference, owner } = entry;
      requirePartitionEntityReference(reference, snapshot);
      const { record, slot } = reference;
      const identity = `${record.partition}:${record.sequence}`;
      if (!transactions.has(identity)) transactions.set(identity, { record, entries: [] });
      transactions.get(identity).entries.push([key, slot, owner]);
    }
    const groups = [...transactions];
    const concurrency = QUANTITY_THRESHOLDS.partitionStorage.recordReadConcurrency;
    for (let start = 0; start < groups.length; start += concurrency) {
      const batch = await Promise.allSettled(
        groups.slice(start, start + concurrency).map(async ([identity, group]) => {
          const slots = cache?.get(identity) ?? new Map();
          await this.#loadRecordSlots({ snapshot, ...group, readBudget }, slots);
          return { identity, ...group, slots };
        }),
      );
      selectRecordBatch(batch, { cache, cacheLimit, collection, select });
    }
    return new Map(query.keys.map((key) => [key, values.get(key)]));
  }

  async readEntityTransaction({ snapshot, collection, key, creation = false }) {
    const query = requireSessionCollectionQuery({ snapshot, collection, keys: [key] });
    return this.journal.withSnapshot(snapshot, async () => {
      const readBudget = createPartitionCollectionReadBudget(snapshot);
      const lookup = creation ? lookupPartitionCreationEntries : lookupPartitionEntities;
      const entries = await lookup(this.journal, query, readBudget);
      const entry = entries.get(key);
      if (entry === null) return null;
      const { reference, owner } = entry;
      requirePartitionEntityReference(reference, snapshot);
      const transaction = await this.read({ snapshot, reference: reference.record, readBudget });
      validateMutation({
        mutation: transaction.mutations[reference.slot],
        reference,
        collection,
        key,
        owner,
      });
      return { generation: reference.record.sequence, reference: reference.record, transaction };
    });
  }

  async readGeneration({ snapshot, generation }) {
    const { request } = await this.journal.readSequenceRecord({ snapshot, sequence: generation });
    return request.payload;
  }

  async read({ snapshot, reference, readBudget }) {
    const { request } = await this.journal.readRecord({ snapshot, reference, readBudget });
    return request.payload;
  }

  async readEntity({ snapshot, reference, collection, key, owner }) {
    requirePartitionEntityReference(reference, snapshot);
    const slots = await this.journal.readRecordSlots({
      snapshot,
      reference: reference.record,
      slots: [reference.slot],
      readBudget: createPartitionCollectionReadBudget(snapshot),
    });
    return validateMutation({
      mutation: slots.get(reference.slot)?.mutation,
      reference,
      collection,
      key,
      owner,
    });
  }
}
