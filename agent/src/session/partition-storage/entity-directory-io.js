/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { AsyncLocalStorage } from "node:async_hooks";
import { constants as zlibConstants, deflateRawSync, inflateRawSync } from "node:zlib";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  partitionJournalError,
  requirePublishedEntityDirectoryPosition,
  requirePartitionEntityPublicationExtent,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_ENTITY_PAGE_CODEC,
  PARTITION_HISTORICAL_PAGE_CODEC,
  decodePartitionHistoricalDirectoryPage,
  encodePartitionHistoricalDirectoryPage,
  decodePartitionEntityDirectoryPage,
  encodePartitionEntityDirectoryPage,
  applyPartitionEntityPageDelta,
  decodePartitionEntityPageDelta,
  encodePartitionEntityPageDelta,
  partitionEntityPageBytes,
  requireEntityDirectoryNode,
} from "@noobot/session-protocol/partition-entity-directory";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";
import {
  CommittedJournalDamage,
  clampJournalTail,
  journalCatalogDirectory,
  openCommittedJournalFile,
  prepareJournalDirectory,
  readJournalBytes,
  restoreDurableTail,
} from "./journal-io.js";
import {
  finishPartitionCommitPhase,
  partitionEntityPageWrite,
  startPartitionCommitPhase,
} from "./partition-commit-observation.js";

const publishedPages = new WeakMap();
const publicationPages = new AsyncLocalStorage();
const pageDeltas = new WeakMap();

async function writePageVector(handle, buffers, position, work) {
  while (buffers.length) {
    const { bytesWritten } = await handle.writev(buffers, position);
    if (bytesWritten === 0) throw new Error("Entity directory write made no progress");
    position += bytesWritten;
    work.writeBytes += bytesWritten;
    let remaining = bytesWritten;
    let complete = 0;
    while (complete < buffers.length && remaining >= buffers[complete].length) {
      remaining -= buffers[complete].length;
      complete += 1;
    }
    buffers.splice(0, complete);
    if (remaining) buffers[0] = buffers[0].subarray(remaining);
  }
}

export function withEntityDirectoryPublicationPages(journal, operation) {
  return publicationPages.run(journal, operation);
}

function getPageCache(journal) {
  let cache = publishedPages.get(journal);
  if (!cache) publishedPages.set(journal, (cache = { nodes: new Map(), bytes: 0 }));
  return cache;
}

function cachePage(cache, key, entry, limit) {
  const { bytes } = entry;
  if (bytes > limit) return;
  const existing = cache.nodes.get(key);
  if (existing) {
    cache.nodes.delete(key);
    cache.bytes -= existing.bytes;
  }
  while (cache.bytes + bytes > limit) {
    const oldest = cache.nodes.keys().next().value;
    cache.bytes -= cache.nodes.get(oldest).bytes;
    cache.nodes.delete(oldest);
  }
  cache.nodes.set(key, entry);
  cache.bytes += bytes;
}

function cacheEntry(position, node) {
  return { node, bytes: position.bytes };
}

function touchPage(nodes, key) {
  const entry = nodes.get(key);
  if (entry !== undefined) {
    nodes.delete(key);
    nodes.set(key, entry);
  }
  return entry;
}

function countPageBytes(byLevel, level, bytes) {
  byLevel[level] = (byLevel[level] ?? 0) + bytes;
}

export function entityDirectoryPath(root, segment) {
  return path.join(journalCatalogDirectory(root), `${segment}.pages`);
}

export async function readEntityDirectoryNode(journal, snapshot, position, readBudget) {
  return readDirectoryPage(journal, snapshot, { position, readBudget, baseOnly: false });
}

export function* entityDirectoryPageDependencies(node) {
  const delta = pageDeltas.get(node);
  if (delta) yield delta.position;
  if (node.level !== 0) for (const [, child] of node.entries) yield child;
}

function requireMaterializedBase(node) {
  if (node.historical || pageDeltas.has(node))
    throw new CommittedJournalDamage("Entity page delta requires a materialized base");
  return node;
}

async function readDirectoryPage(journal, snapshot, { position, readBudget, baseOnly }) {
  const publishing = publicationPages.getStore() === journal;
  const started = publishing ? startPartitionCommitPhase() : undefined;
  requirePublishedEntityDirectoryPosition(position, snapshot.entityDirectory, snapshot.limits);
  const key = JSON.stringify(position);

  const cache = getPageCache(journal);
  const cached = touchPage(cache.nodes, key);
  if (cached) {
    const node = requireEntityDirectoryNode(cached.node, snapshot);
    finishPartitionCommitPhase("entityDirectoryPage:cached", started);
    return baseOnly ? requireMaterializedBase(node) : node;
  }
  const handle = await openCommittedJournalFile(
    entityDirectoryPath(journal.root, position.segment),
    "entity directory segment",
  );
  return withStorageCleanup(
    async () => {
      const bytes = await readJournalBytes(handle, {
        length: position.bytes,
        offset: position.offset,
        work: journal.work,
        readBudget,
      });
      const decoding = started === undefined ? undefined : startPartitionCommitPhase();
      const decoded = decodeCommittedPage(bytes, snapshot, position, baseOnly);
      const node =
        bytes[0] === PARTITION_ENTITY_PAGE_CODEC.delta
          ? await materializePageDelta(journal, snapshot, readBudget, decoded)
          : decoded;
      finishPartitionCommitPhase("entityDirectoryPage:decode", decoding);
      countPageBytes(journal.work.entityDirectoryReadBytesByLevel, node.level, bytes.length);
      cachePage(cache, key, cacheEntry(position, node), snapshot.limits.pageBytes);
      return node;
    },
    async () => {
      try {
        await handle.close();
      } finally {
        finishPartitionCommitPhase("entityDirectoryPage:cold", started);
      }
    },
  );
}

function decodeCommittedPage(bytes, snapshot, position, baseOnly) {
  try {
    if (bytes[0] !== PARTITION_ENTITY_PAGE_CODEC.delta) {
      const node = decodePage(bytes, snapshot);
      return baseOnly ? requireMaterializedBase(node) : node;
    }
    if (baseOnly) throw new TypeError("Entity page deltas must not chain");
    const delta = decodePartitionEntityPageDelta(
      bytes.subarray(1).toString("utf8"),
      snapshot,
      position,
    );
    requirePublishedEntityDirectoryPosition(delta.base, snapshot.entityDirectory, snapshot.limits);
    return delta;
  } catch (cause) {
    throw new CommittedJournalDamage("Invalid entity directory page", { cause });
  }
}

async function materializePageDelta(journal, snapshot, readBudget, delta) {
  const base = await readDirectoryPage(journal, snapshot, {
    position: delta.base,
    readBudget,
    baseOnly: true,
  });
  try {
    const node = applyPartitionEntityPageDelta(base, delta, snapshot);
    pageDeltas.set(node, { position: delta.base, node: base });
    return node;
  } catch (cause) {
    throw new CommittedJournalDamage("Invalid materialized entity page", { cause });
  }
}

function decodePage(bytes, snapshot) {
  const codec = bytes[0];
  const payload = bytes.subarray(1);
  if (codec === PARTITION_HISTORICAL_PAGE_CODEC)
    return decodePartitionHistoricalDirectoryPage(payload, snapshot);
  if (codec === PARTITION_ENTITY_PAGE_CODEC.literal)
    return decodePartitionEntityDirectoryPage(payload.toString("utf8"), snapshot);
  if (codec === PARTITION_ENTITY_PAGE_CODEC.deflateRaw)
    return decodePartitionEntityDirectoryPage(
      inflateRawSync(payload, {
        maxOutputLength: partitionEntityPageBytes(snapshot.limits) - 1,
      }).toString("utf8"),
      snapshot,
    );
  throw new TypeError("Unknown entity directory page encoding");
}

function encodePage(node, limits) {
  if (node.historical === true) {
    const payload = encodePartitionHistoricalDirectoryPage(node);
    if (payload.length + 1 > partitionEntityPageBytes(limits)) return null;
    return Buffer.concat([Buffer.from([PARTITION_HISTORICAL_PAGE_CODEC]), payload]);
  }
  const serialized = Buffer.from(encodePartitionEntityDirectoryPage(node));
  if (serialized.length + 1 > partitionEntityPageBytes(limits)) return null;
  const compressed = deflateRawSync(serialized, { level: zlibConstants.Z_BEST_SPEED });
  return compressed.length < serialized.length
    ? Buffer.concat([Buffer.from([PARTITION_ENTITY_PAGE_CODEC.deflateRaw]), compressed])
    : Buffer.concat([Buffer.from([PARTITION_ENTITY_PAGE_CODEC.literal]), serialized]);
}

export class EntityDirectoryAppend {
  constructor(journal, snapshot) {
    this.journal = journal;
    this.snapshot = snapshot;
    this.directory = structuredClone(snapshot.entityDirectory);
    this.pages = new Map();
    this.sealedCollections = new Map();
  }

  fork() {
    const next = new EntityDirectoryAppend(this.journal, this.snapshot);
    next.directory = structuredClone(this.directory);
    next.pages = new Map(this.pages);
    next.sealedCollections = new Map(this.sealedCollections);
    return next;
  }

  async read(position) {
    const staged = this.pages.get(`${position.segment}:${position.offset}`);
    if (staged) return staged.node;
    return readEntityDirectoryNode(this.journal, this.snapshot, position);
  }

  append(node) {
    const position = this.appendIfFits(node);
    if (position === null)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Entity directory page exceeds protocol budget",
      );
    return position;
  }

  appendIfFits(node) {
    if (pageDeltas.has(node)) node = { ...node };
    const bytes = encodePage(node, this.snapshot.limits);
    return bytes === null ? null : this.#appendEncoded(node, bytes);
  }

  appendReplacementIfFits(node, previous, prior) {
    const base =
      previous === null ? null : (pageDeltas.get(prior) ?? { position: previous, node: prior });
    return this.#appendWithBaseIfFits(node, base);
  }

  #appendWithBaseIfFits(node, base) {
    const bytes = encodePage(node, this.snapshot.limits);
    if (bytes === null) return null;
    if (base === null || this.pages.has(`${base.position.segment}:${base.position.offset}`))
      return this.#appendEncoded(node, bytes);
    const delta = encodePartitionEntityPageDelta(base.position, base.node, node);
    if (delta === null) return this.#appendEncoded(node, bytes);
    const encoded = Buffer.from(String.fromCharCode(PARTITION_ENTITY_PAGE_CODEC.delta) + delta);
    if (encoded.length >= bytes.length) return this.#appendEncoded(node, bytes);
    pageDeltas.set(node, base);
    return this.#appendEncoded(node, encoded);
  }

  #appendEncoded(node, bytes) {
    const directory = this.directory;
    if (directory.offset + bytes.length > this.snapshot.limits.partitionBytes) {
      directory.segment += 1;
      directory.offset = 0;
    }
    const position = { segment: directory.segment, offset: directory.offset, bytes: bytes.length };
    directory.offset += bytes.length;
    directory.bytes += bytes.length;
    this.pages.set(`${position.segment}:${position.offset}`, { position, node, bytes });
    return position;
  }

  #relocateChildren(node, relocated) {
    if (node.level === 0) return null;
    let entries = null;
    for (const [index, [bound, child, sequence]] of node.entries.entries()) {
      const next = relocated.get(`${child.segment}:${child.offset}`);
      if (
        next === undefined ||
        (next.segment === child.segment &&
          next.offset === child.offset &&
          next.bytes === child.bytes)
      )
        continue;
      entries ??= node.entries.slice();
      entries[index] = [bound, next, sequence];
    }
    return entries;
  }

  #stagedPageRoots() {
    const reachable = new Map();
    const pageKey = ({ segment, offset }) => `${segment}:${offset}`;
    const mark = (position, root) => {
      const key = pageKey(position);
      const page = this.pages.get(key);
      if (!page || reachable.has(key)) return;
      reachable.set(key, root);
      for (const dependency of entityDirectoryPageDependencies(page.node)) mark(dependency, root);
    };
    for (const name of ["identities", "historicalOperations", "latestUpdates", "activeCollection"])
      if (this.directory[name]) mark(this.directory[name].position, name);
    for (const { collectionRoot } of this.sealedCollections.values())
      if (collectionRoot) mark(collectionRoot.position, "sealedCollection");
    return reachable;
  }

  retainPublishedPages() {
    const staged = this.pages;
    const { identities, historicalOperations, latestUpdates, activeCollection } = this.directory;
    const pageKey = ({ segment, offset }) => `${segment}:${offset}`;
    const reachable = this.#stagedPageRoots();
    if (reachable.size === staged.size) return;

    this.pages = new Map();
    const start = this.snapshot.entityDirectory;
    Object.assign(this.directory, {
      segment: start.segment,
      offset: start.offset,
      bytes: start.bytes,
    });
    const relocated = new Map();
    let gap = false;
    for (const [key, page] of staged) {
      if (!reachable.has(key)) {
        gap = true;
        continue;
      }
      if (!gap) {
        const { segment, offset, bytes } = page.position;
        Object.assign(this.directory, { segment, offset: offset + bytes });
        this.directory.bytes += bytes;
        this.pages.set(key, page);
        continue;
      }
      const entries = this.#relocateChildren(page.node, relocated);
      const next =
        entries === null
          ? this.#appendEncoded(page.node, page.bytes)
          : this.#appendWithBaseIfFits(
              { ...page.node, entries },
              pageDeltas.get(page.node) ?? null,
            );
      if (next === null)
        throw partitionJournalError(
          "SESSION_STORAGE_CORRUPT",
          "Relocated entity directory page exceeds protocol budget",
        );
      relocated.set(key, next);
    }
    const retainRoot = (root) => {
      if (root === null) return null;
      const position = relocated.get(pageKey(root.position));
      return position === undefined ? root : { ...root, position };
    };
    for (const [partition, extent] of this.sealedCollections)
      this.sealedCollections.set(partition, {
        ...extent,
        collectionRoot: retainRoot(extent.collectionRoot),
      });
    this.directory.identities = retainRoot(identities);
    this.directory.historicalOperations = retainRoot(historicalOperations);
    this.directory.latestUpdates = retainRoot(latestUpdates);
    this.directory.activeCollection = retainRoot(activeCollection);
  }

  plan(head) {
    this.retainPublishedPages();
    requirePartitionEntityPublicationExtent(this.snapshot, this.directory);
    head.entityDirectory = { ...this.directory };
  }

  async persistSegment(pages, roots) {
    const { segment, offset } = pages[0].position;
    const extending = segment === this.snapshot.entityDirectory.segment && offset > 0;
    const file = entityDirectoryPath(this.journal.root, segment);
    const handle = extending
      ? await openCommittedJournalFile(file, "entity directory segment", "r+")
      : await fsOpen(file, "w+");
    await withStorageCleanup(
      async () => {
        if (extending) await clampJournalTail(handle, this.snapshot.entityDirectory.offset);
        const vectorLimit = QUANTITY_THRESHOLDS.partitionStorage.entityPageWriteVectorLimit;
        for (let start = 0; start < pages.length; start += vectorLimit) {
          const batch = pages.slice(start, start + vectorLimit);
          await writePageVector(
            handle,
            batch.map((page) => page.bytes),
            batch[0].position.offset,
            this.journal.work,
          );
        }
        for (const page of pages) {
          if (roots) {
            const { segment, offset } = page.position;
            partitionEntityPageWrite.publish({
              root: roots.get(`${segment}:${offset}`),
              level: page.node.level,
              bytes: page.bytes.length,
            });
          }
          countPageBytes(
            this.journal.work.entityDirectoryWriteBytesByLevel,
            page.node.level,
            page.bytes.length,
          );
        }
        await handle.sync();
      },
      () => handle.close(),
    );
  }

  cachePublishedPages() {
    const cache = getPageCache(this.journal);
    for (const { position, node } of this.pages.values())
      cachePage(
        cache,
        JSON.stringify(position),
        cacheEntry(position, deepFreeze(node)),
        this.snapshot.limits.pageBytes,
      );
  }

  async persist() {
    if (!this.pages.size) return;
    const roots = partitionEntityPageWrite.hasSubscribers ? this.#stagedPageRoots() : null;
    const directory = journalCatalogDirectory(this.journal.root);
    const { segment, offset } = this.snapshot.entityDirectory;
    if (this.pages.values().next().value.position.segment > segment)
      await restoreDurableTail(
        entityDirectoryPath(this.journal.root, segment),
        offset,
        "entity directory segment",
      );
    if (offset === 0) await prepareJournalDirectory(this.journal.root, directory);
    const persistSegmentInDurableOrder = async (pages) => {
      await this.persistSegment(pages, roots);
      if (pages[0].position.segment !== segment || offset === 0)
        await syncStorageDirectory(directory);
    };
    let pages = [];
    for (const page of this.pages.values()) {
      if (pages.length && pages[0].position.segment !== page.position.segment) {
        await persistSegmentInDurableOrder(pages);
        pages = [];
      }
      pages.push(page);
    }
    await persistSegmentInDurableOrder(pages);
  }
}
