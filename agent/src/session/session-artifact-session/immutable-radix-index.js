/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { contentDigest } from "./immutable-storage-io.js";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { recordStorageWork } from "../session-storage-observation.js";
import { isFunction, isPlainObject } from "@noobot/shared/value";
import { runStorageBatch } from "./storage-batch-results.js";

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_INDEX_TARGET_BYTES,
} from "@noobot/session-protocol/immutable-storage-graph";

const KEY_BYTES = LENGTH_THRESHOLDS.immutableStorage.keyBytes;
const BLOCK_BYTES = IMMUTABLE_VALUE_BLOCK_BYTES;
const HASH_DIGITS = 64;
const DIGIT_PATTERN = /^[a-f0-9]$/;

function keyDigest(key) {
  if (typeof key !== "string" || !key || Buffer.byteLength(key) > KEY_BYTES)
    throw new TypeError("Immutable index requires a bounded non-empty string key");
  return contentDigest(key);
}

function validateLeaf(page, prefix, requireReference) {
  if (!page.entries.length || Buffer.byteLength(JSON.stringify(page)) > BLOCK_BYTES)
    throw immutableStorageError("Invalid index leaf size");
  let previous = null;
  for (const entry of page.entries) {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw immutableStorageError("Invalid index leaf entry");
    const [key, reference] = entry;
    if (typeof key !== "string" || !key || Buffer.byteLength(key) > KEY_BYTES)
      throw immutableStorageError("Invalid stored index key");
    if (!keyDigest(key).startsWith(prefix))
      throw immutableStorageError("Index leaf key does not belong to its hash path");
    requireReference(reference);
    if (previous !== null && key <= previous) throw immutableStorageError("Unordered index leaf");
    previous = key;
  }
  return page;
}

export function validateImmutableIndexPage(page, prefix, requireReference) {
  const depth = prefix.length;
  if (page?.kind === "index-leaf" && Array.isArray(page.entries))
    return validateLeaf(page, prefix, requireReference);
  if (page?.kind === "index-branch" && page.depth === depth && depth < HASH_DIGITS) {
    if (!isPlainObject(page.children)) throw immutableStorageError("Invalid index children");
    const entries = Object.entries(page.children);
    if (!entries.length || entries.some(([digit]) => !DIGIT_PATTERN.test(digit)))
      throw immutableStorageError("Invalid index branch");
    for (const [, reference] of entries) requireReference(reference);
    return page;
  }
  throw immutableStorageError("Invalid immutable index page");
}

function findLeafReference(entries, key) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const [candidate, reference] = entries[middle];
    if (candidate === key) return reference;
    if (candidate < key) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

export async function readImmutableIndexPage(objects, reference, prefix) {
  recordStorageWork("immutableIndexPageReads");
  return validateImmutableIndexPage(
    await objects.readPage(reference),
    prefix,
    objects.requireReference.bind(objects),
  );
}

function readLeafQueries(entries, selected, found) {
  const sparse = selected.length * Math.ceil(Math.log2(entries.length + 1)) < entries.length;
  if (sparse) {
    for (const { key } of selected) found.set(key, findLeafReference(entries, key));
    return;
  }
  const values = new Map(entries);
  for (const { key } of selected) found.set(key, values.get(key) ?? null);
}

function selectPageQueries(page, { selected, prefix }, found) {
  if (page.kind === "index-leaf") {
    readLeafQueries(page.entries, selected, found);
    return [];
  }
  const groups = new Map();
  for (const query of selected) {
    const digit = query.digest[prefix.length];
    if (!groups.has(digit)) groups.set(digit, []);
    groups.get(digit).push(query);
  }
  const children = [];
  for (const [digit, group] of groups) {
    const child = page.children[digit];
    if (child !== undefined)
      children.push({ reference: child, selected: group, prefix: prefix + digit });
  }
  return children;
}

export async function readImmutableIndexPages(objects, nodes) {
  const pages = new Array(nodes.length);
  await runStorageBatch(
    nodes.map((node, slot) => ({ ...node, slot })),
    async ({ reference, prefix, slot }) => {
      pages[slot] = await objects.readIndexPage(reference, prefix);
    },
  );
  return pages;
}

function compareUpdateKeys(left, right) {
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function recordLeafChange(result, previous, value) {
  if (previous === value) return false;
  result.changed += 1;
  if (previous === null) result.added += 1;
  if (value === null) result.removed += 1;
  return true;
}

export class ImmutableRadixIndex {
  constructor(objects, targetBytes = IMMUTABLE_INDEX_TARGET_BYTES) {
    this.objects = objects;
    this.targetBytes = targetBytes;
  }

  async readPage(reference, prefix) {
    return this.objects.readIndexPage(reference, prefix);
  }

  async get(root, key) {
    const digest = keyDigest(key);
    let reference = root;
    let depth = 0;
    while (reference !== null) {
      const page = await this.readPage(reference, digest.slice(0, depth));
      if (page.kind === "index-leaf") return findLeafReference(page.entries, key);
      reference = page.children[digest[depth++]] ?? null;
    }
    return null;
  }

  async getMany(root, keys) {
    const queries = [...new Set(keys)].map((key) => ({ key, digest: keyDigest(key) }));
    const found = new Map(queries.map(({ key }) => [key, null]));
    let level =
      root === null || !queries.length ? [] : [{ reference: root, selected: queries, prefix: "" }];
    while (level.length) {
      const next = new Array(level.length);
      const pages = await this.objects.readIndexPages(level);
      for (let slot = 0; slot < level.length; slot += 1) {
        next[slot] = selectPageQueries(pages[slot], level[slot], found);
      }
      level = next.flat();
    }
    return found;
  }

  async set(root, key, value) {
    return this.setMany(root, [[key, value]]);
  }

  async setMany(root, entries) {
    return (await this.applyMany(root, entries)).root;
  }

  async applyMany(root, entries) {
    for (const [, value] of entries) if (value !== null) this.objects.requireReference(value);
    return this.updateMany(
      root,
      entries.map(([key]) => key),
      ({ slot }) => entries[slot][1],
    );
  }

  async updateMany(root, keys, resolve) {
    if (!isFunction(resolve)) throw new TypeError("Index updates require a synchronous resolver");
    const result = { root, added: 0, removed: 0, changed: 0 };
    const seen = new Set();
    const changes = keys.map((key, slot) => {
      const digest = keyDigest(key);
      if (seen.has(key)) throw new TypeError("Duplicate immutable index change");
      seen.add(key);
      return { key, slot, digest };
    });
    if (!changes.length) return result;
    const initial = { reference: root, changes, depth: 0 };
    const levels = [];
    let level = [initial];

    while (level.length) {
      const stored = level.filter(({ reference }) => reference !== null);
      const pages = await this.objects.readIndexPages(
        stored.map(({ reference, changes, depth }) => ({
          reference,
          prefix: changes[0].digest.slice(0, depth),
        })),
      );
      for (let slot = 0; slot < stored.length; slot += 1) stored[slot].page = pages[slot];
      for (const node of level) this.prepareUpdate(node);
      levels.push(level);
      level = level.flatMap((node) => node.children ?? []);
    }

    for (const nodes of levels.reverse())
      await runStorageBatch(nodes, async (node) => {
        node.result = await this.writeUpdate(node, result, resolve);
      });
    result.root = initial.result;
    return result;
  }

  prepareUpdate(node) {
    const { reference, changes, depth } = node;
    const page = reference === null ? { kind: "index-leaf", entries: [] } : node.page;
    node.page = page;
    if (page.kind !== "index-branch") return;
    const groups = new Map();
    for (const change of changes) {
      const digit = change.digest[depth];
      if (!groups.has(digit)) groups.set(digit, []);
      groups.get(digit).push(change);
    }
    node.children = [...groups].map(([digit, group]) => ({
      digit,
      reference: page.children[digit] ?? null,
      changes: group,
      depth: depth + 1,
    }));
  }

  async writeBranchUpdate({ reference, changes, depth, page, children: updates }) {
    const children = { ...page.children };
    let changed = false;
    for (const { digit, reference: previous, result: child } of updates) {
      if (child === previous) continue;
      changed = true;
      if (child === null) delete children[digit];
      else children[digit] = child;
    }
    if (!changed) return reference;
    if (!Object.keys(children).length) return null;
    return this.objects.putIndexPage(
      { kind: "index-branch", depth, children },
      changes[0].digest.slice(0, depth),
    );
  }

  async writeUpdate(node, result, resolve) {
    const { reference, changes, depth, page } = node;
    if (page.kind === "index-branch") return this.writeBranchUpdate(node);
    const updates = [...changes].sort(compareUpdateKeys);
    const entries = [];
    let position = 0;
    let changed = false;
    for (const { key, slot } of updates) {
      while (position < page.entries.length && page.entries[position][0] < key)
        entries.push(page.entries[position++]);
      const previous = page.entries[position];
      const existing = previous?.[0] === key;
      const previousValue = existing ? previous[1] : null;
      const value = resolve({ key, previous: previousValue, slot });
      if (value !== null) this.objects.requireReference(value);
      if (existing) position += 1;
      if (recordLeafChange(result, previousValue, value)) changed = true;
      if (value !== null) entries.push([key, value]);
    }
    if (!changed) return reference;
    while (position < page.entries.length) entries.push(page.entries[position++]);
    return this.writeEntries(entries, depth);
  }

  async writeEntries(entries, depth) {
    if (!entries.length) return null;
    const leaf = { kind: "index-leaf", entries };
    if (Buffer.byteLength(JSON.stringify(leaf)) <= this.targetBytes)
      return this.objects.putIndexPage(leaf, keyDigest(entries[0][0]).slice(0, depth));
    if (depth >= HASH_DIGITS)
      throw immutableStorageError("Immutable index hash collision capacity exceeded");
    const groups = new Map();
    for (const entry of entries) {
      const digit = keyDigest(entry[0])[depth];
      if (!groups.has(digit)) groups.set(digit, []);
      groups.get(digit).push(entry);
    }
    const children = {};
    for (const [digit, group] of groups)
      children[digit] = await this.writeEntries(group, depth + 1);
    return this.objects.putIndexPage(
      { kind: "index-branch", depth, children },
      keyDigest(entries[0][0]).slice(0, depth),
    );
  }

  async *entries(root, prefix = "") {
    if (root === null) return;
    const page = await this.readPage(root, prefix);
    yield* this.pageEntries(page, prefix);
  }

  async *pageEntries(page, prefix) {
    if (page.kind === "index-leaf") {
      yield* page.entries;
      return;
    }
    const nodes = Object.entries(page.children).map(([digit, reference]) => ({
      reference,
      prefix: prefix + digit,
    }));
    const pages = await this.objects.readIndexPages(nodes);
    for (let slot = 0; slot < nodes.length; slot += 1)
      yield* this.pageEntries(pages[slot], nodes[slot].prefix);
  }
}
