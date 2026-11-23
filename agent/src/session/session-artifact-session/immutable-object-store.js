/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { fsMkdir, fsOpen } from "../../shared/storage/fs-adapter.js";
import {
  contentDigest,
  replaceSyncedFile,
  syncStorageDirectory,
  writeDurableReplacement,
} from "./immutable-storage-io.js";
export {
  contentDigest,
  syncStorageDirectory,
  writeDurableReplacement,
} from "./immutable-storage-io.js";
import { recordStorageWork } from "../session-storage-observation.js";
import { ImmutableValueStore } from "./immutable-value-store.js";
import { runStorageBatch } from "./storage-batch-results.js";
import { ImmutableTransactionGraph } from "./immutable-transaction-graph.js";
import { immutablePageReferences } from "@noobot/session-protocol/immutable-storage-graph";

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { readHandlePrefix } from "@noobot/shared/read-file-prefix";

import {
  IMMUTABLE_SESSION_DIRECTORIES,
  IMMUTABLE_SESSION_FORMAT,
  decodeImmutableJsonBytes,
  immutableStorageError,
  requireObjectReference,
} from "@noobot/session-protocol/immutable-storage";
export { immutableStorageError } from "@noobot/session-protocol/immutable-storage";

const BLOCK_BYTES = LENGTH_THRESHOLDS.immutableStorage.blockBytes;

async function readImmutableObjectBytes(file, allowAbsent) {
  let handle;
  try {
    handle = await fsOpen(file, "r");
  } catch (error) {
    if (allowAbsent && error.code === "ENOENT") return null;
    throw error;
  }
  return readHandlePrefix(handle, BLOCK_BYTES + 1);
}

export class ImmutableObjectStore extends ImmutableValueStore {
  static format = IMMUTABLE_SESSION_FORMAT;

  constructor(sessionDir, objectRead) {
    super(objectRead);
    this.directory = path.join(sessionDir, IMMUTABLE_SESSION_DIRECTORIES.objects);
    this.writeBatches = new AsyncLocalStorage();
  }

  async withDurabilityBatch(operation) {
    if (this.writeBatches.getStore()) throw new Error("Nested immutable durability batch");
    const batch = {
      active: true,
      directories: new Set(),
      graph: new ImmutableTransactionGraph(requireObjectReference),
    };
    try {
      return await this.writeBatches.run(batch, operation);
    } finally {
      batch.active = false;
      batch.directories.clear();
      batch.graph.clear();
    }
  }

  async publishReachable(roots) {
    const batch = this.writeBatches.getStore();
    if (!batch?.active) throw new Error("Immutable durability batch is not active");
    const objects = batch.graph.reachable(roots);
    await runStorageBatch(objects, ({ reference, bytes }) => this.publishObject(reference, bytes));
    await runStorageBatch([...batch.directories], syncStorageDirectory);
    if (batch.directories.size) {
      await syncStorageDirectory(this.directory);
      await syncStorageDirectory(path.dirname(this.directory));
    }
    batch.directories.clear();
    batch.graph.clear();
  }

  async persistObjectDirectory(directory) {
    const batch = this.writeBatches.getStore();
    if (batch) {
      if (!batch.active) throw new Error("Immutable durability batch has ended");
      batch.directories.add(directory);
      return;
    }
    await syncStorageDirectory(directory);
    await syncStorageDirectory(this.directory);
    await syncStorageDirectory(path.dirname(this.directory));
  }

  async restoreRecords(replacements, { signal } = {}) {
    const repaired = [];
    for (const [reference, bytes] of replacements) {
      signal?.throwIfAborted();
      const file = this.objectPath(reference);
      const current = await readImmutableObjectBytes(file, true);
      if (current?.equals(bytes)) await syncStorageDirectory(path.dirname(file));
      else {
        await fsMkdir(path.dirname(file), { recursive: true });
        await writeDurableReplacement(file, bytes);
        repaired.push(
          `${IMMUTABLE_SESSION_DIRECTORIES.objects}/${reference.slice(0, 2)}/${reference.slice(2)}`,
        );
      }
    }

    if (replacements.size) {
      await syncStorageDirectory(this.directory);
      await syncStorageDirectory(path.dirname(this.directory));
    }
    return repaired;
  }

  objectPath(reference) {
    const hash = requireObjectReference(reference);
    return path.join(this.directory, hash.slice(0, 2), hash.slice(2));
  }

  requireReference(reference) {
    return requireObjectReference(reference);
  }

  referenceDigest(reference) {
    return requireObjectReference(reference);
  }

  linkReferences(reference, references) {
    this.writeBatches.getStore()?.graph.link(reference, references);
  }

  async read(reference) {
    requireObjectReference(reference);
    return this.readObject(reference, this.#loadObject, reference);
  }

  #loadObject(reference) {
    const batch = this.writeBatches.getStore();
    if (batch && !batch.active) throw new Error("Immutable durability batch has ended");
    const staged = batch?.graph.objects.get(reference);
    return staged === undefined ? this.readPublished(reference) : Buffer.from(staged);
  }

  readPublished(reference) {
    return this.#readPublishedObject(reference, false);
  }

  async #readPublishedObject(reference, allowAbsent) {
    const file = this.objectPath(reference);
    let bytes;
    try {
      bytes = await readImmutableObjectBytes(file, allowAbsent);
    } catch (cause) {
      throw immutableStorageError(`Cannot read immutable object ${reference}`, cause);
    }
    if (bytes === null) return null;
    recordStorageWork("immutableObjectReads");
    recordStorageWork("immutableReadBytes", bytes.length);
    if (bytes.length > BLOCK_BYTES || contentDigest(bytes) !== reference)
      throw immutableStorageError(`Immutable object checksum mismatch: ${reference}`);
    return bytes;
  }

  async put(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > BLOCK_BYTES)
      throw new TypeError("Immutable object exceeds block size");

    bytes = Buffer.from(bytes);
    const reference = contentDigest(bytes);
    const batch = this.writeBatches.getStore();
    if (!batch) return this.publishObject(reference, bytes);
    if (!batch.active) throw new Error("Immutable durability batch has ended");
    batch.graph.put(reference, bytes);
    return reference;
  }

  async publishObject(reference, bytes) {
    const file = this.objectPath(reference);
    if ((await this.#readPublishedObject(reference, true)) === null) {
      await fsMkdir(path.dirname(file), { recursive: true });
      await replaceSyncedFile(file, bytes);
      recordStorageWork("immutableObjectWrites");
      recordStorageWork("immutableWriteBytes", bytes.length);
    }

    await this.persistObjectDirectory(path.dirname(file));
    return reference;
  }

  async readPage(reference) {
    const bytes = await this.read(reference);
    return decodeImmutableJsonBytes(bytes, reference);
  }

  async putPage(page) {
    const batch = this.writeBatches.getStore();
    const references = batch ? immutablePageReferences(page) : [];
    const reference = await this.put(Buffer.from(JSON.stringify(page)));
    batch?.graph.link(reference, references);
    return reference;
  }
}
