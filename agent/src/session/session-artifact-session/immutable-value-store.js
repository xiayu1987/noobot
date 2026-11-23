/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { messageReadJsonBytes } from "@noobot/session-protocol/message-read-budget";
import { contentDigest } from "./immutable-storage-io.js";
import { replaceImmutableValueSuffix } from "./immutable-value-suffix.js";
import { runStorageBatch } from "./storage-batch-results.js";
import {
  readImmutableIndexPage,
  readImmutableIndexPages,
  validateImmutableIndexPage,
} from "./immutable-radix-index.js";
import {
  requireImmutableContentReuse,
  requireImmutableValueParts,
  isImmutableValuePartsPage,
  immutableInlineValueParts,
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_VALUE_INLINE_BYTES,
  IMMUTABLE_VALUE_READ_BATCH_RECORDS,
  decodeImmutableInlineValue,
  IMMUTABLE_VALUE_MAX_DEPTH,
  immutableValueSplitOffset,
  requireImmutableValueBytePage,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  decodeImmutableJsonBytes,
  immutableStorageError,
} from "@noobot/session-protocol/immutable-storage";
const BLOCK_BYTES = IMMUTABLE_VALUE_BLOCK_BYTES;

function capturedNodeMatches(page, node, { totalBytes, reference, expectedBytes }) {
  if (page.bytes > node.maximumBytes) return false;
  if (node.endBytes !== undefined && (page.bytes === 0 || page.bytes > node.endBytes - totalBytes))
    return false;
  return node.reference !== reference || expectedBytes === null || page.bytes === expectedBytes;
}

function capturedValueMatches(objects, previous, node) {
  const { page } = previous;
  if (node.left)
    return (
      page.kind === "value-branch" &&
      page.left === node.left.reference &&
      page.right === node.right.reference
    );
  if (page.kind === "value-inline") return decodeImmutableInlineValue(page).equals(node.bytes);
  if (page.kind === "value")
    return objects.referenceDigest(page.data) === contentDigest(node.bytes);
  return false;
}

function splitCapturedValueLevel(nodes) {
  const next = [];
  for (const node of nodes) {
    if (node.bytes.length <= BLOCK_BYTES) continue;
    const midpoint = immutableValueSplitOffset(node.bytes.length);
    node.left = { bytes: node.bytes.subarray(0, midpoint), offset: node.offset };
    node.right = { bytes: node.bytes.subarray(midpoint), offset: node.offset + midpoint };
    next.push(node.left, node.right);
  }
  return next;
}

async function readValueLeaf(objects, page, signal) {
  const bytes =
    page.kind === "value-inline" ? decodeImmutableInlineValue(page) : await objects.read(page.data);
  signal?.throwIfAborted();
  if (bytes.length !== page.bytes) throw immutableStorageError("Immutable value size mismatch");
  return bytes;
}

function valueMetadata(page, value) {
  const parts = isImmutableValuePartsPage(page) ? page.parts : [];
  for (const { path } of parts)
    if (!isPlainObject(value?.[path[0]]) || value[path[0]][path[1]] !== null)
      throw immutableStorageError("Invalid immutable value content slot");
  return { value, parts };
}

async function readByteTreeBatch(objects, selected) {
  const missing = selected.filter((node) => node.page === undefined);
  const records = missing.length
    ? await objects.readMany(missing.map((node) => node.reference))
    : new Map();
  const leaves = [];
  const next = [];
  for (const node of selected) {
    if (node.depth > IMMUTABLE_VALUE_MAX_DEPTH)
      throw immutableStorageError("Immutable value tree exceeds protocol depth");
    node.page ??= decodeImmutableJsonBytes(records.get(node.reference), node.reference);
    const { page } = node;
    requireImmutableValueBytePage(page);
    if (node.parentBytes !== undefined && (page.bytes === 0 || page.bytes >= node.parentBytes))
      throw immutableStorageError("Invalid immutable value size");
    if (page.kind === "value-branch") {
      objects.requireReference(page.left);
      objects.requireReference(page.right);
      node.children = [page.left, page.right].map((reference) => ({
        reference,
        depth: node.depth + 1,
        parentBytes: page.bytes,
      }));
      next.push(...node.children);
    } else if (page.kind === "value-inline") node.bytes = decodeImmutableInlineValue(page);
    else leaves.push(node);
  }
  const data = leaves.length
    ? await objects.readMany(leaves.map((node) => node.page.data))
    : new Map();
  for (const node of leaves) {
    node.bytes = data.get(node.page.data);
    if (node.bytes.length !== node.page.bytes)
      throw immutableStorageError("Immutable value size mismatch");
  }
  return next;
}

async function readByteTrees(objects, roots) {
  const trees = roots.map((root) => ({ ...root, depth: 0 }));
  let level = trees;
  while (level.length) {
    const next = [];
    for (let offset = 0; offset < level.length; offset += IMMUTABLE_VALUE_READ_BATCH_RECORDS) {
      const selected = level.slice(offset, offset + IMMUTABLE_VALUE_READ_BATCH_RECORDS);
      next.push(...(await readByteTreeBatch(objects, selected)));
    }
    level = next;
  }
  function collect(node, chunks) {
    if (!node.children) {
      chunks.push(node.bytes);
      return node.bytes.length;
    }
    const bytes = node.children.reduce((total, child) => total + collect(child, chunks), 0);
    requireImmutableValueBytePage(node.page, bytes);
    return bytes;
  }
  return trees.map((tree) => {
    const chunks = [];
    collect(tree, chunks);
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  });
}

async function putCapturedValueBytes(objects, bytes, previousReference) {
  const previous = new Map();
  async function capture(reference, offset, depth, expectedBytes) {
    if (offset >= bytes.length && expectedBytes !== undefined) return expectedBytes;
    if (depth > IMMUTABLE_VALUE_MAX_DEPTH)
      throw immutableStorageError("Immutable value tree exceeds protocol depth");
    const page = await objects.readPage(reference);
    requireImmutableValueBytePage(page, expectedBytes);
    previous.set(`${offset}:${page.bytes}`, { reference, page });
    if (page.kind === "value-branch") {
      const left = await capture(page.left, offset, depth + 1);
      if (!left || left >= page.bytes)
        throw immutableStorageError("Invalid immutable value branch size");
      const right = await capture(page.right, offset + left, depth + 1, page.bytes - left);
      if (!left || !right || left + right !== page.bytes)
        throw immutableStorageError("Invalid immutable value branch size");
    }
    return page.bytes;
  }
  if (previousReference !== undefined && bytes.length) await capture(previousReference, 0, 0);
  const root = { bytes, offset: 0 };
  const levels = [[root]];
  for (let level = 0; level < levels.length; level += 1) {
    const next = splitCapturedValueLevel(levels[level]);
    if (next.length) levels.push(next);
  }
  for (const nodes of levels.reverse())
    await runStorageBatch(nodes, async (node) => {
      const old = previous.get(`${node.offset}:${node.bytes.length}`);
      if (old && capturedValueMatches(objects, old, node)) {
        node.reference = old.reference;
        return;
      }
      node.reference = await objects.putPage(
        node.left
          ? {
              kind: "value-branch",
              left: node.left.reference,
              right: node.right.reference,
              bytes: node.bytes.length,
            }
          : await objects.valueLeaf(node.bytes, node === root),
      );
    });
  return root.reference;
}

export class ImmutableValueStore {
  #objectRead;

  constructor(objectRead) {
    this.#objectRead = objectRead;
  }

  readObject(reference, load, ...args) {
    if (this.#objectRead === undefined) return load.call(this, ...args);
    return this.#objectRead(reference, () => load.call(this, ...args));
  }

  async valueLeaf(bytes, standalone) {
    return standalone && bytes.length <= IMMUTABLE_VALUE_INLINE_BYTES
      ? { kind: "value-inline", data: bytes.toString("base64"), bytes: bytes.length }
      : { kind: "value", data: await this.put(bytes), bytes: bytes.length };
  }

  async putIndexPage(page, prefix) {
    validateImmutableIndexPage(page, prefix, this.requireReference.bind(this));
    return this.putPage(page);
  }

  async readIndexPage(reference, prefix) {
    return readImmutableIndexPage(this, reference, prefix);
  }

  async readIndexPages(nodes) {
    return readImmutableIndexPages(this, nodes);
  }

  async readMany(references) {
    const records = new Map();
    for (const reference of new Set(references)) records.set(reference, await this.read(reference));
    return records;
  }

  async readValues(references, { budget } = {}) {
    return this.readDecodedValues(references, false, budget);
  }

  async readValuesMetadata(references, { budget } = {}) {
    return this.readDecodedValues(references, true, budget);
  }

  async readDecodedValues(references, metadata, budget) {
    const values = [];
    for (let offset = 0; offset < references.length; offset += IMMUTABLE_VALUE_READ_BATCH_RECORDS) {
      const selected = references.slice(offset, offset + IMMUTABLE_VALUE_READ_BATCH_RECORDS);
      values.push(...(await this.readDecodedValueBatch(selected, metadata, budget)));
    }
    return values;
  }

  async readDecodedValueBatch(selected, metadata, budget) {
    const records = await this.readMany(selected);
    const pages = selected.map((reference) =>
      decodeImmutableJsonBytes(records.get(reference), reference),
    );
    const templateReferences = [];
    for (const page of pages) {
      if (!isImmutableValuePartsPage(page)) continue;
      requireImmutableValueParts(page, this.requireReference.bind(this));
      if (page.kind === "value-parts") templateReferences.push(page.template);
    }
    const templates = templateReferences.length
      ? await this.readMany(templateReferences)
      : new Map();
    const byteRoots = selected.flatMap((reference, position) => {
      const page = pages[position];
      if (page?.kind === "value-parts-inline") return [];
      if (page?.kind !== "value-parts") return [{ reference, page, position }];
      const template = decodeImmutableJsonBytes(templates.get(page.template), page.template);
      if (isImmutableValuePartsPage(template))
        throw immutableStorageError("Composite value templates must be plain JSON values");
      return [{ reference: page.template, page: template, position }];
    });
    for (const { page } of byteRoots) {
      requireImmutableValueBytePage(page);
      budget?.consume("bytes", page.bytes);
    }
    for (const page of pages)
      if (page.kind === "value-parts-inline")
        budget?.consume("bytes", messageReadJsonBytes(page.value));
    const bytes = await readByteTrees(this, byteRoots);
    const values = pages.map((page) =>
      page?.kind === "value-parts-inline" ? page.value : undefined,
    );
    for (let slot = 0; slot < byteRoots.length; slot += 1)
      values[byteRoots[slot].position] = decodeImmutableJsonBytes(
        bytes[slot],
        byteRoots[slot].reference,
      );
    const decodedValues = new Array(selected.length);
    await runStorageBatch(
      selected.map((reference, position) => ({ reference, position })),
      async ({ position }) => {
        const decoded = valueMetadata(pages[position], values[position]);
        decodedValues[position] = metadata
          ? decoded
          : await this.materializeValue(decoded, { budget });
      },
    );
    return decodedValues;
  }

  async withReadScope(operation) {
    return operation();
  }

  async withSnapshot(snapshot, operation) {
    if (snapshot?.format !== this.constructor.format)
      throw immutableStorageError("Snapshot format disagrees with its record backend");
    return this.withReadScope(operation);
  }

  async validateSnapshot() {}

  async withPhysicalRepairOverlay({ signal }, operation) {
    signal?.throwIfAborted();
    return operation();
  }

  initialHeadFields() {
    return {};
  }

  beginCommit() {}

  publicationHeadFields() {
    return {};
  }

  async putValue(value, { references = [], contentPaths = [], parts: reusedParts = [] } = {}) {
    let template = value;
    const captured = [];
    const reused = requireImmutableContentReuse(
      value,
      reusedParts,
      contentPaths,
      this.requireReference.bind(this),
    );
    for (const path of contentPaths) {
      const part = reused.find((part) => JSON.stringify(part.path) === JSON.stringify(path));
      if (part) {
        captured.push({ path: [...path], reference: part.reference });
        continue;
      }
      if (!isPlainObject(value?.[path[0]]) || !Object.hasOwn(value[path[0]], path[1])) continue;
      const json = JSON.stringify(value[path[0]][path[1]]);
      if (json === undefined) continue;
      template = { ...template, [path[0]]: { ...template[path[0]], [path[1]]: null } };
      captured.push({ path: [...path], bytes: Buffer.from(json) });
    }
    const json = JSON.stringify(template);
    if (json === undefined) throw new TypeError("Immutable values must be JSON serializable");
    const bytes = Buffer.from(json);
    const parts = [];
    for (const part of captured)
      parts.push({
        path: part.path,
        reference: part.reference ?? (await putCapturedValueBytes(this, part.bytes)),
      });
    let reference;
    const inline = parts.length ? immutableInlineValueParts(template, parts) : null;
    if (inline) reference = await this.putPage(inline);
    else {
      const templateReference = await putCapturedValueBytes(this, bytes);
      reference = parts.length
        ? await this.putPage({ kind: "value-parts", template: templateReference, parts })
        : templateReference;
    }
    this.linkReferences(reference, references);
    return reference;
  }

  async putValueBytes(bytes, { previousReference } = {}) {
    if (!Buffer.isBuffer(bytes)) throw new TypeError("Immutable value bytes must be a Buffer");
    return putCapturedValueBytes(this, Buffer.from(bytes), previousReference);
  }

  replaceValueSuffix(reference, expectedSuffix, suffix) {
    return replaceImmutableValueSuffix(this, reference, expectedSuffix, suffix);
  }

  async putValueChunks(chunks, { signal } = {}) {
    const trees = [];
    let block = Buffer.allocUnsafe(BLOCK_BYTES);
    let used = 0;
    const branch = async (left, right) => {
      signal?.throwIfAborted();
      const bytes = left.bytes + right.bytes;
      if (!Number.isSafeInteger(bytes)) throw immutableStorageError("Invalid immutable value size");
      return {
        bytes,
        reference: await this.putPage({
          kind: "value-branch",
          left: left.reference,
          right: right.reference,
          bytes,
        }),
      };
    };
    const flush = async () => {
      signal?.throwIfAborted();
      let tree = {
        bytes: used,
        reference: await this.putPage(
          await this.valueLeaf(block.subarray(0, used), trees.length === 0),
        ),
      };
      while (trees.length && trees.at(-1).bytes === tree.bytes)
        tree = await branch(trees.pop(), tree);
      trees.push(tree);
      block = Buffer.allocUnsafe(BLOCK_BYTES);
      used = 0;
    };
    const appendChunk = async (chunk) => {
      signal?.throwIfAborted();
      if (!Buffer.isBuffer(chunk)) throw new TypeError("Immutable value chunks must be Buffers");
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(BLOCK_BYTES - used, chunk.length - offset);
        chunk.copy(block, used, offset, offset + length);
        used += length;
        offset += length;
        if (used === BLOCK_BYTES) await flush();
      }
    };
    for await (const chunk of chunks) await appendChunk(chunk);
    signal?.throwIfAborted();
    if (used || !trees.length) await flush();
    let root = trees.pop();
    while (trees.length) root = await branch(trees.pop(), root);
    return root.reference;
  }

  async readValueBytes(reference, { expectedBytes = null, rootPage, signal } = {}) {
    signal?.throwIfAborted();
    const page = rootPage === undefined ? await this.readPage(reference) : rootPage;
    if (isImmutableValuePartsPage(page)) {
      if (expectedBytes !== null)
        throw immutableStorageError("Composite values cannot appear inside a byte tree");
      return Buffer.from(JSON.stringify(await this.readValue(reference, page, { signal })));
    }
    const chunks = [];
    for await (const bytes of this.readValueChunks(reference, {
      expectedBytes,
      rootPage: page,
      signal,
    }))
      chunks.push(bytes);
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  }

  async *readValueChunks(reference, { expectedBytes = null, rootPage, signal } = {}) {
    const pending = [
      { reference, page: rootPage, maximumBytes: Number.MAX_SAFE_INTEGER, depth: 0 },
    ];
    let totalBytes = 0;
    while (pending.length) {
      signal?.throwIfAborted();
      const next = pending.pop();
      if (next.end) {
        requireImmutableValueBytePage(next.page, totalBytes - next.startBytes);
        continue;
      }
      if (next.depth > IMMUTABLE_VALUE_MAX_DEPTH)
        throw immutableStorageError("Immutable value tree exceeds protocol depth");
      const page = next.page === undefined ? await this.readPage(next.reference) : next.page;
      signal?.throwIfAborted();
      if (isImmutableValuePartsPage(page))
        throw immutableStorageError("Composite values cannot appear inside a byte tree");
      requireImmutableValueBytePage(page);
      if (!capturedNodeMatches(page, next, { totalBytes, reference, expectedBytes }))
        throw immutableStorageError("Invalid immutable value size");
      if (page.kind === "value" || page.kind === "value-inline") {
        const bytes = await readValueLeaf(this, page, signal);
        totalBytes += bytes.length;
        yield bytes;
      } else {
        this.requireReference(page.left);
        this.requireReference(page.right);
        pending.push(
          { end: true, page, startBytes: totalBytes },
          {
            reference: page.right,
            maximumBytes: page.bytes - 1,
            endBytes: totalBytes + page.bytes,
            depth: next.depth + 1,
          },
          {
            reference: page.left,
            maximumBytes: page.bytes - 1,
            endBytes: totalBytes + page.bytes,
            depth: next.depth + 1,
          },
        );
      }
    }
  }

  async readValueMetadata(reference, rootPage, { signal } = {}) {
    signal?.throwIfAborted();
    const page = rootPage === undefined ? await this.readPage(reference) : rootPage;
    signal?.throwIfAborted();
    if (page?.kind === "value-parts-inline") {
      requireImmutableValueParts(page, this.requireReference.bind(this));
      return valueMetadata(page, page.value);
    }
    if (page?.kind === "value-parts") {
      requireImmutableValueParts(page, this.requireReference.bind(this));
      return this.decodeValueMetadata(reference, page, await this.readPage(page.template), signal);
    }
    return this.decodeValueMetadata(reference, page, null, signal);
  }

  async decodeValueMetadata(reference, page, template, signal) {
    if (page?.kind !== "value-parts")
      return valueMetadata(
        page,
        decodeImmutableJsonBytes(
          await this.readValueBytes(reference, { rootPage: page, signal }),
          reference,
        ),
      );
    if (isImmutableValuePartsPage(template))
      throw immutableStorageError("Composite value templates must be plain JSON values");
    const value = decodeImmutableJsonBytes(
      await this.readValueBytes(page.template, { rootPage: template, signal }),
      page.template,
    );
    return valueMetadata(page, value);
  }

  async readValue(reference, rootPage, options) {
    return this.materializeValue(await this.readValueMetadata(reference, rootPage, options));
  }

  async materializeValue({ value, parts }, { budget } = {}) {
    return (await this.materializeValues([{ value, parts }], { budget }))[0];
  }

  async materializeValues(records, { budget } = {}) {
    for (let offset = 0; offset < records.length; offset += IMMUTABLE_VALUE_READ_BATCH_RECORDS) {
      const selected = records.slice(offset, offset + IMMUTABLE_VALUE_READ_BATCH_RECORDS);
      const slots = selected.flatMap(({ value, parts }) =>
        parts.map(({ path, reference }) => ({ value, path, reference })),
      );
      const values = slots.length
        ? await this.readValues(
            slots.map((slot) => slot.reference),
            { budget },
          )
        : [];
      for (let position = 0; position < slots.length; position += 1) {
        const { value, path } = slots[position];
        value[path[0]][path[1]] = values[position];
      }
    }
    return records.map(({ value }) => value);
  }
}
