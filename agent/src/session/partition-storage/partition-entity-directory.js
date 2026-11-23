/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PARTITION_ENTITY_DIRECTORY,
  PARTITION_ENTITY_DIRECTORY_FORMAT,
  partitionHistoricalDirectoryMatches,
  partitionHistoricalDirectorySharedPrefix,
  partitionHistoricalDirectorySlot,
  requirePartitionHistoricalDirectoryPath,
  partitionEntityNodeMaxUpdateSequence,
  partitionEntityUpdateSequence,
  partitionEntityPageCapacity,
  partitionEntityPageCount,
} from "@noobot/session-protocol/partition-entity-directory";
import { requirePartitionLocalCollection } from "@noobot/session-protocol/partition-collection-query";
import {
  PartitionAdmissionRejection,
  extendPartitionEntityProjection,
  finishPartitionEntityProjection,
  partitionJournalError,
  requireLocalPartitionReference,
  requirePartitionPublicationCapacity,
  requiresImmediatePartitionProjection,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_HISTORICAL_OPERATIONS,
  partitionEntityCollectionRange,
  partitionEntityKey,
  partitionMutationOwner,
  samePartitionEntityOwner,
} from "@noobot/session-protocol/partition-transaction";
import { withJournalPublicationLock } from "./journal-publication-lock.js";
import { syncStorageDirectory } from "../../shared/storage/durable-file.js";
import { EntityDirectoryAppend, readEntityDirectoryNode } from "./entity-directory-io.js";
import { publishJournalHead, readJournalHead } from "./journal-io.js";
import { activePartitionEntry, readPartitionEntry } from "./journal-directory.js";
import {
  startPartitionCommitPhase,
  finishPartitionCommitPhase,
} from "./partition-commit-observation.js";

function lowerBound(entries, key) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (entries[middle][0] < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

function checkPageBoundary(node, level, bound, updateSequence) {
  if (
    node.level !== level ||
    node.historical !== undefined ||
    (bound !== null &&
      (node.entries.at(-1)[0] !== bound ||
        partitionEntityNodeMaxUpdateSequence(node) !== updateSequence))
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Entity directory page boundary mismatch",
    );
}

function selectLeafEntries(node, queries, results) {
  for (const [identity, key] of queries) {
    const entry = node.entries[lowerBound(node.entries, identity)];
    if (entry?.[0] === identity) results.set(key, entry[1]);
  }
}

async function readEntityPaths(context, { position, level, bound, updateSequence }, queries) {
  const { readNode, results, updateOwners } = context;
  const node = await readNode(position);
  checkPageBoundary(node, level, bound, updateSequence);
  if (!node.level) return selectLeafEntries(node, queries, results);
  const children = new Map();
  for (const query of queries) {
    const slot = lowerBound(node.entries, query[0]);
    if (slot === node.entries.length) continue;
    if (updateOwners && node.entries[slot][2] <= updateOwners.get(query[1]).sequence) continue;
    if (!children.has(slot)) children.set(slot, []);
    children.get(slot).push(query);
  }
  for (const [slot, selected] of children) {
    const [bound, position, updateSequence] = node.entries[slot];
    await readEntityPaths(context, { position, level: level - 1, bound, updateSequence }, selected);
  }
}

async function readLocalEntityPaths(context, extent, queries) {
  const { collectionRoot } = extent;
  if (collectionRoot === null) return;
  await readEntityPaths(context, { ...collectionRoot, bound: null }, queries);
  for (const [, key] of queries) {
    const entry = context.results.get(key);
    if (entry) requireLocalPartitionReference(entry.reference.record, extent);
  }
}

export async function visitPartitionCollectionKeys(journal, snapshot, collections, accept) {
  const selectedCollections = new Set(collections);
  const ranges = [...selectedCollections].map((collection) => {
    requirePartitionLocalCollection(collection);
    return partitionEntityCollectionRange(collection);
  });
  if (ranges.length === 0) return;
  async function visitBranch(extent, node, lower, selected) {
    for (const [bound, position, updateSequence] of node.entries) {
      const matching = selected.filter(
        ({ start, end }) => bound >= start && (lower === null || lower < end),
      );
      const previousBound = lower;
      lower = bound;
      if (matching.length === 0) continue;
      await visit(
        extent,
        { position, level: node.level - 1, bound, updateSequence },
        previousBound,
        matching,
      );
    }
  }
  async function visit(extent, { position, level, bound, updateSequence }, lower, selected) {
    const node = await readEntityDirectoryNode(journal, snapshot, position);
    checkPageBoundary(node, level, bound, updateSequence);
    if (lower !== null && node.entries[0][0] <= lower)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Overlapping entity directory pages");
    if (level) return visitBranch(extent, node, lower, selected);
    for (const [identity, entry] of node.entries) {
      requireLocalPartitionReference(entry.reference.record, extent);
      const [storedCollection, key] = JSON.parse(identity);
      if (selectedCollections.has(storedCollection)) await accept(key, storedCollection);
    }
  }
  for (let partition = 0; partition <= snapshot.tail.partition; partition += 1) {
    const extent = await readPartitionEntry({
      root: journal.root,
      head: snapshot,
      partition,
      work: journal.work,
    });
    if (extent.collectionRoot !== null)
      await visit(extent, { ...extent.collectionRoot, bound: null }, null, ranges);
  }
}

export async function lookupLocalEntities(
  journal,
  { snapshot, partition, collection, keys },
  readBudget,
) {
  const results = new Map(keys.map((key) => [key, null]));
  const extent = await readPartitionEntry({
    root: journal.root,
    head: snapshot,
    partition,
    work: journal.work,
    readBudget,
  });
  const queries = keys.map((key) => [partitionEntityKey(collection, key), key]);
  await readLocalEntityPaths(
    {
      readNode: (position) => readEntityDirectoryNode(journal, snapshot, position, readBudget),
      results,
    },
    extent,
    queries,
  );
  return results;
}

export async function lookupPartitionCreationEntries(
  journal,
  { snapshot, collection, keys },
  readBudget,
) {
  requirePartitionLocalCollection(collection);
  const results = new Map(keys.map((key) => [key, null]));
  const root = snapshot.entityDirectory.identities;
  if (root === null || !keys.length) return results;
  await readEntityPaths(
    {
      readNode: (position) => readEntityDirectoryNode(journal, snapshot, position, readBudget),
      results,
    },
    { ...root, bound: null },
    keys.map((key) => [partitionEntityKey(collection, key), key]),
  );
  return results;
}

export async function lookupPartitionHistoricalOperation(journal, snapshot, key, readBudget) {
  const entries = await lookupHistoricalOperations(journal, snapshot, [key], readBudget);
  return entries.get(key);
}

async function lookupHistoricalOperations(journal, snapshot, keys, readBudget) {
  const results = new Map(keys.map((key) => [key, null]));
  const root = snapshot.entityDirectory.historicalOperations;
  async function visit(position, prefix, queries) {
    const node = await readEntityDirectoryNode(journal, snapshot, position, readBudget);
    checkHistoricalPath(node, prefix);
    if (!prefix.length && node.level !== root.level)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Historical root kind mismatch");
    if (!node.level) return selectLeafEntries(node, queries, results);
    const branchPrefix = node.sharedPrefix;
    const matching = queries.filter(([key]) =>
      partitionHistoricalDirectoryMatches(key, branchPrefix),
    );
    for (const [slot, selected] of groupHistoricalEntries(matching, branchPrefix)) {
      const entry = node.entries[lowerBound(node.entries, slot)];
      if (entry?.[0] === slot) await visit(entry[1], branchPrefix + slot, selected);
    }
  }
  if (root !== null && keys.length)
    await visit(
      root.position,
      "",
      keys.map((key) => [partitionEntityKey(PARTITION_HISTORICAL_OPERATIONS, key), key]),
    );
  return results;
}

async function readOwnerPartitions(
  journal,
  { snapshot, collection, owners, unresolved },
  readBudget,
) {
  const partitions = new Map();
  for (const [, key] of unresolved) {
    const { partition } = owners.get(key);
    if (!partitions.has(partition)) partitions.set(partition, []);
    partitions.get(partition).push(key);
  }
  const results = new Map();
  for (const [partition, keys] of partitions) {
    const entries = await lookupLocalEntities(
      journal,
      { snapshot, partition, collection, keys },
      readBudget,
    );
    for (const [key, entry] of entries) results.set(key, entry);
  }
  return results;
}

export async function lookupPartitionEntities(
  journal,
  { snapshot, collection, keys, owners },
  readBudget,
) {
  if (!keys.length) return new Map();
  if (collection === PARTITION_HISTORICAL_OPERATIONS)
    return lookupHistoricalOperations(journal, snapshot, keys, readBudget);

  const results = await lookupLocalEntities(
    journal,
    { snapshot, partition: snapshot.tail.partition, collection, keys },
    readBudget,
  );
  if (snapshot.tail.partition === 0) return results;
  const pending = [];
  for (const [key, entry] of results) {
    if (entry === null && owners?.get(key).partition !== snapshot.tail.partition)
      pending.push([partitionEntityKey(collection, key), key]);
  }
  const { latestUpdates, identities } = snapshot.entityDirectory;
  const context = {
    readNode: (position) => readEntityDirectoryNode(journal, snapshot, position, readBudget),
    results,
  };
  if (latestUpdates !== null && pending.length)
    await readEntityPaths(
      { ...context, updateOwners: owners },
      { ...latestUpdates, bound: null },
      pending,
    );
  const unresolved = pending.filter(([, key]) => results.get(key) === null);
  if (owners) {
    const entries = await readOwnerPartitions(
      journal,
      { snapshot, collection, owners, unresolved },
      readBudget,
    );
    for (const [key, entry] of entries) results.set(key, entry);
  } else if (identities !== null && unresolved.length)
    await readEntityPaths(context, { ...identities, bound: null }, unresolved);
  return results;
}

async function readDeferredChildren(context, node, sequence) {
  for (const [bound, position, updateSequence] of node.entries) {
    if (updateSequence <= sequence) continue;
    await readDeferredEntries(context, { position, level: node.level - 1, bound, updateSequence });
  }
}

async function readDeferredEntries(context, { position, level, bound, updateSequence }) {
  const { journal, snapshot, entries } = context;
  const { start, mutationCount } = snapshot.deferredEntityUpdates;
  const node = await readEntityDirectoryNode(journal, snapshot, position);
  checkPageBoundary(node, level, bound, updateSequence);
  if (level !== 0) return readDeferredChildren(context, node, start.sequence);
  for (const [key, { reference, owner }] of node.entries) {
    if (reference.record.partition !== start.partition)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Deferred reference is not local");
    if (partitionEntityUpdateSequence({ reference, owner }) <= start.sequence) continue;
    if (entries.length >= mutationCount)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Deferred updates exceed reservation");
    entries.push([key, reference, owner]);
  }
}

function publishNodes(writer, node) {
  const pages = partitionEntityPageCount(
    node.entries.length,
    partitionEntityPageCapacity(writer.snapshot.limits),
  );
  const children = [];
  for (let index = 0; index < pages; index += 1) {
    const start = Math.floor((index * node.entries.length) / pages);
    const end = Math.floor(((index + 1) * node.entries.length) / pages);
    const entries = node.entries.slice(start, end);
    const page = { ...node, entries };
    children.push([
      entries.at(-1)[0],
      writer.append(page),
      partitionEntityNodeMaxUpdateSequence(page),
    ]);
  }
  return children;
}

function retainPage(node, position) {
  return [node.entries.at(-1)[0], position, partitionEntityNodeMaxUpdateSequence(node)];
}

function mergeLeafEntries(writer, node, { updates, unique, position: previous, activeOwners }) {
  const entries = [];
  let slot = 0;
  for (const [key, reference, owner] of updates) {
    while (slot < node.entries.length && node.entries[slot][0] < key)
      entries.push(node.entries[slot++]);
    const registered = node.entries[slot]?.[0] === key ? node.entries[slot][1] : undefined;
    if (activeOwners && owner !== null && registered) {
      requireLocalPartitionReference(registered.reference.record, activeOwners.extent);
      requireRegisteredOwner(registered, owner);
      activeOwners.pending.delete(key);
    }
    if (registered && unique)
      throw new PartitionAdmissionRejection(
        "SESSION_ENTITY_EXISTS",
        "Entity identity has already been created",
      );
    if (registered) slot += 1;
    const entry = [key, { owner: partitionMutationOwner(owner, reference), reference }];
    entries.push(entry);
  }
  while (slot < node.entries.length) entries.push(node.entries[slot++]);
  const page = { ...node, entries };
  if (entries.length <= PARTITION_ENTITY_DIRECTORY.maxEntries) {
    const position = writer.appendReplacementIfFits(page, previous, node);
    if (position !== null)
      return {
        level: 0,
        children: [[entries.at(-1)[0], position, partitionEntityNodeMaxUpdateSequence(page)]],
      };
  }
  if (previous !== null && updates[0][0] > node.entries.at(-1)[0]) {
    const suffix = { ...node, entries: entries.slice(node.entries.length) };
    return { level: 0, children: [retainPage(node, previous), ...publishNodes(writer, suffix)] };
  }
  return { level: 0, children: publishNodes(writer, page) };
}

function branchUpdateEnd(updates, first, upper) {
  let end = first;
  while (end < updates.length && updates[end][0] <= upper) end += 1;
  return end;
}

async function mergeBranchEntries(
  writer,
  node,
  { updates, unique, position, activeOwners, creations },
) {
  const entries = [];
  let first = 0;
  for (const [slot, entry] of node.entries.entries()) {
    const [upper, child, updateSequence] = entry;
    const end =
      slot === node.entries.length - 1 ? updates.length : branchUpdateEnd(updates, first, upper);
    if (end === first) entries.push(entry);
    else {
      const { children } = await mergeDirectoryEntries(writer, {
        position: child,
        updates: updates.slice(first, end),
        level: node.level - 1,
        bound: upper,
        updateSequence,
        unique,
        activeOwners,
        creations,
      });
      entries.push(children[0][1] === child ? entry : children[0], ...children.slice(1));
    }
    first = end;
  }
  if (entries.length <= partitionEntityPageCapacity(writer.snapshot.limits)) {
    const page = { ...node, entries };
    const replacement = writer.appendReplacementIfFits(page, position, node);
    if (replacement === null)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Entity branch exceeds page budget");
    return { level: node.level, children: [retainPage(page, replacement)] };
  }
  if (node.entries.every((entry, slot) => entries[slot] === entry)) {
    const suffix = { ...node, entries: entries.slice(node.entries.length) };
    return {
      level: node.level,
      children: [retainPage(node, position), ...publishNodes(writer, suffix)],
    };
  }
  return { level: node.level, children: publishNodes(writer, { ...node, entries }) };
}

async function mergeDirectoryEntries(writer, query) {
  const { position, level, bound, updateSequence } = query;
  const node =
    position === null
      ? {
          format: PARTITION_ENTITY_DIRECTORY_FORMAT,
          epoch: writer.snapshot.epoch,
          level: 0,
          entries: [],
        }
      : await writer.read(position);
  checkPageBoundary(node, level, bound, updateSequence);
  const { creations, updates, unique } = query;
  const key =
    creations && (unique || updates.every((entry) => entry[2] === null))
      ? JSON.stringify([position, updates[0][0], updates.at(-1)[0]])
      : null;
  if (key !== null && !unique && creations.has(key)) return creations.get(key);
  const merged =
    node.level === 0
      ? mergeLeafEntries(writer, node, query)
      : await mergeBranchEntries(writer, node, query);
  if (key !== null && unique) creations.set(key, merged);
  return merged;
}

function compareEntityKeys([left], [right]) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function publishEntityEntries(writer, root, updates, { activeOwners, creations } = {}) {
  if (!updates.length) return;
  let { level, children } = await mergeDirectoryEntries(writer, {
    ...(writer.directory[root] ?? { position: null, level: 0 }),
    updates: updates.sort(compareEntityKeys),
    bound: null,
    unique: root === "identities",
    activeOwners,
    creations,
  });
  while (children.length > 1) {
    if (level >= PARTITION_ENTITY_DIRECTORY.maxLevel)
      throw new PartitionAdmissionRejection(
        "SESSION_INDEX_BUDGET",
        "Entity directory depth is exhausted",
      );
    level += 1;
    children = publishNodes(writer, {
      format: PARTITION_ENTITY_DIRECTORY_FORMAT,
      epoch: writer.snapshot.epoch,
      level,
      entries: children,
    });
  }
  writer.directory[root] = { position: children[0][1], level };
}

function sameDirectoryRoot(left, right) {
  if (left === null || right === null) return left === right;
  const a = left.position;
  const b = right.position;
  return (
    left.level === right.level &&
    a.segment === b.segment &&
    a.offset === b.offset &&
    a.bytes === b.bytes
  );
}

function checkHistoricalPath(node, prefix) {
  try {
    requirePartitionHistoricalDirectoryPath(node, prefix);
  } catch (cause) {
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

function groupHistoricalEntries(entries, prefix) {
  const groups = new Map();
  for (const entry of entries) {
    const slot = partitionHistoricalDirectorySlot(entry[0], prefix);
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(entry);
  }
  return groups;
}

async function appendHistoricalPage(writer, previous, prefix, additions) {
  const node = previous === undefined ? null : await writer.read(previous);
  if (node) checkHistoricalPath(node, prefix);
  const page = {
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch: writer.snapshot.epoch,
    historical: true,
  };
  if (!node && additions.length === 1)
    return { position: writer.append({ ...page, level: 0, entries: additions }), level: 0 };
  const identities = additions.map(([key]) => key);
  if (node?.level === 0) identities.push(node.entries[0][0]);
  if (new Set(identities).size !== identities.length)
    throw new PartitionAdmissionRejection(
      "SESSION_ENTITY_EXISTS",
      "Historical operation already exists",
    );
  const branchPrefix = partitionHistoricalDirectorySharedPrefix(
    identities,
    prefix,
    node?.level === 1 ? node.sharedPrefix : undefined,
  );
  const children = new Map();
  if (node?.level === 0) {
    children.set(partitionHistoricalDirectorySlot(node.entries[0][0], branchPrefix), previous);
  } else if (node?.level === 1 && branchPrefix === node.sharedPrefix) {
    for (const [slot, position] of node.entries) children.set(slot, position);
  } else if (node?.level === 1) {
    children.set(node.sharedPrefix[branchPrefix.length], previous);
  }
  for (const [slot, selected] of groupHistoricalEntries(additions, branchPrefix)) {
    const child = await appendHistoricalPage(
      writer,
      children.get(slot),
      branchPrefix + slot,
      selected,
    );
    children.set(slot, child.position);
  }
  const entries = [...children]
    .sort(compareEntityKeys)
    .map(([slot, position]) => [slot, position, 0]);
  return {
    position: writer.append({ ...page, level: 1, sharedPrefix: branchPrefix, entries }),
    level: 1,
  };
}

async function publishHistoricalOperations(writer, updates) {
  if (!updates.length) return;
  const entries = updates.map(([key, reference, owner]) => [
    key,
    { owner: partitionMutationOwner(owner, reference), reference },
  ]);
  writer.directory.historicalOperations = await appendHistoricalPage(
    writer,
    writer.directory.historicalOperations?.position,
    "",
    entries,
  );
}

function recordReference(snapshot, { request, cursor }, slot) {
  return {
    record: { epoch: snapshot.epoch, partition: cursor.partition, sequence: request.sequence },
    slot,
  };
}

async function planEntityUpdateProjection(writer, snapshot, entries) {
  await publishEntityEntries(writer, "latestUpdates", entries);
  const head = { ...snapshot, deferredEntityUpdates: null };
  writer.plan(head);
  finishPartitionEntityProjection(snapshot, head);
  return head;
}

function requireRegisteredOwner(registered, owner) {
  if (!registered || !samePartitionEntityOwner(registered.owner, owner))
    throw new PartitionAdmissionRejection(
      "SESSION_STORAGE_IDENTITY",
      "Entity does not belong to its creation owner",
    );
}

async function validateSealedOwners(journal, { writer, previous, active, owners, rolling }) {
  const results = new Map();
  const context = { readNode: (position) => writer.read(position), results };
  const byPartition = new Map();
  for (const [key, owner] of owners) {
    if (
      owner.epoch !== active.epoch ||
      owner.partition > active.partition ||
      (!rolling && owner.partition === active.partition)
    )
      requireRegisteredOwner(undefined, owner);
    if (!byPartition.has(owner.partition)) byPartition.set(owner.partition, []);
    byPartition.get(owner.partition).push([key, key]);
  }

  for (const [partition, selected] of byPartition) {
    const extent =
      writer.sealedCollections.get(partition) ??
      (await readPartitionEntry({
        root: journal.root,
        head: previous,
        partition,
        work: journal.work,
      }));
    await readLocalEntityPaths(context, extent, selected);
  }
  for (const [key, owner] of owners) {
    requireRegisteredOwner(results.get(key), owner);
  }
}

export async function planPartitionEntityDirectory(
  journal,
  { previous, accepted, snapshot, record, state },
) {
  const creations = [];
  const historicalOperations = [];
  const local = [];
  const updates = [];
  const owners = new Map();
  for (const [slot, mutation] of record.request.payload.mutations.entries()) {
    const key = partitionEntityKey(mutation.collection, mutation.key);
    const entry = [key, recordReference(snapshot, record, slot), mutation.owner];
    if (mutation.collection === PARTITION_HISTORICAL_OPERATIONS) {
      historicalOperations.push(entry);
      continue;
    }
    local.push(entry);
    if (mutation.owner === null) creations.push(entry);
    else {
      updates.push(entry);
      owners.set(key, mutation.owner);
    }
  }
  extendPartitionEntityProjection(snapshot, record.cursor, updates.length);
  let writer = state;
  const rolling = accepted.tail.partition !== snapshot.tail.partition;
  if (local.length || historicalOperations.length || rolling) {
    writer = writer ? writer.fork() : new EntityDirectoryAppend(journal, previous);
    const active = activePartitionEntry(accepted);
    if (rolling) {
      writer.sealedCollections.set(active.partition, active);
      writer.directory.activeCollection = null;
    }
    const shareCreationRoot =
      creations.length === local.length &&
      sameDirectoryRoot(writer.directory.identities, writer.directory.activeCollection);
    const sharedSubtrees =
      !shareCreationRoot && !rolling && creations.length && active.collectionRoot !== null
        ? new Map()
        : undefined;
    const started = startPartitionCommitPhase();
    try {
      await publishEntityEntries(writer, "identities", creations, { creations: sharedSubtrees });
    } finally {
      finishPartitionCommitPhase("mergeCreationDirectory", started);
    }
    await publishHistoricalOperations(writer, historicalOperations);
    if (shareCreationRoot) writer.directory.activeCollection = writer.directory.identities;
    else
      await publishEntityEntries(writer, "activeCollection", local, {
        activeOwners: rolling ? undefined : { extent: active, pending: owners },
        creations: sharedSubtrees,
      });
    if (owners.size)
      await validateSealedOwners(journal, { writer, previous, active, owners, rolling });
    writer.plan(snapshot);
  }
  if (requiresImmediatePartitionProjection(accepted, snapshot)) {
    await publishEntityEntries(writer, "latestUpdates", updates);
    snapshot.deferredEntityUpdates = null;
    writer.plan(snapshot);
  }
  requirePartitionPublicationCapacity(snapshot);
  return writer;
}

async function publishDeferredEntityUpdates(journal, previous) {
  const root = previous.entityDirectory.activeCollection;
  if (previous.deferredEntityUpdates === null || root === null)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing deferred entity updates");
  const entries = [];
  await readDeferredEntries({ journal, snapshot: previous, entries }, { ...root, bound: null });
  if (entries.length === 0)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Deferred updates have no references");
  const writer = new EntityDirectoryAppend(journal, previous);
  const head = await planEntityUpdateProjection(writer, previous, entries);
  await writer.persist();
  await publishJournalHead(journal, head);
  writer.cachePublishedPages();
  return head;
}

export async function projectPartitionEntityUpdates(journal) {
  return withJournalPublicationLock(journal.lockPath, async () => {
    const previous = await readJournalHead(journal.root, journal.work);
    if (previous.sessionId !== journal.head.sessionId || previous.epoch !== journal.head.epoch)
      throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Journal identity changed");
    if (previous.deferredEntityUpdates === null) {
      await syncStorageDirectory(journal.root);
      return { sequence: previous.sequence, projected: false };
    }
    const head = await publishDeferredEntityUpdates(journal, previous);
    return { sequence: head.sequence, projected: true };
  });
}
