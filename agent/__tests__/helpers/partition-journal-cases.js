/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { filePath as path } from "@noobot/path-resolver";
import {
  capturePartitionTransactionRequest,
  createPartitionTransactionRequest,
} from "@noobot/session-protocol/partition-transaction";
import { isFunction } from "@noobot/shared/value";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { entityDirectoryPath } from "../../src/session/partition-storage/entity-directory-io.js";
import { journalRetentionsDirectory } from "../../src/session/partition-storage/journal-io.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

export function listSnapshotRetentionFiles(journal) {
  return readdir(journalRetentionsDirectory(journal.root));
}

export function wrapHandle(handle, overrides) {
  return new Proxy(handle, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(target, key, target);
      return isFunction(value) ? value.bind(target) : value;
    },
  });
}

export function directoryPageRead(root, { segment, offset, bytes }) {
  return [entityDirectoryPath(root, segment), offset, bytes];
}

export async function observeDirectoryPageReads(operation, onOpen = () => {}) {
  const previous = getFsAdapter();
  const reads = [];
  setFsAdapter({
    ...previous,
    async open(file, flags, ...args) {
      onOpen(file, flags);
      const handle = await previous.open(file, flags, ...args);
      if (flags !== "r" || !String(file).endsWith(".pages")) return handle;
      return {
        async read(buffer, offset, length, position) {
          const result = await handle.read(buffer, offset, length, position);
          reads.push([String(file), position, result.bytesRead]);
          return result;
        },
        close: () => handle.close(),
      };
    },
  });
  try {
    return { result: await operation(reads), reads };
  } finally {
    setFsAdapter(previous);
  }
}

export function journalTestLimits(overrides = {}) {
  return {
    partitionBytes: 64 * 1024,
    partitionRecords: 128,
    transactionBytes: 4 * 1024,
    queueBytes: 128 * 1024,
    batchBytes: 32 * 1024,
    batchRecords: 32,
    batchWaitMs: 1,
    receiptBytes: 16 * 1024,
    receiptRecords: 8,
    entityProjectionBytes: 128 * 1024,
    entityProjectionRecords: 64,
    retentionRecords: 16,
    pageBytes: 16 * 1024,
    pageRecords: 8,
    quotaBytes: 128 * 1024 * 1024,
    quotaPartitions: 4096,
    quotaInodes: 32 * 1024,
    reserveBytes: 64 * 1024,
    reserveInodes: 16,
    ...overrides,
  };
}

export function createTestPartitionStorageBudget() {
  return { journalLimits: journalTestLimits(), maxJournals: 1 };
}

export async function createJournalCase(
  t,
  overrides = {},
  { autoClose = true, publication = "journal", sessionId = "test-session" } = {},
) {
  const base = await mkdtemp(path.join(tmpdir(), "partition-journal-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "session");
  const journal = await PartitionJournal.create({
    root,
    durableAncestor: path.dirname(base),
    sessionId,
    limits: journalTestLimits(overrides),
    publication,
  });
  if (autoClose) t.after(() => journal.close());
  return { journal, root, sessionId };
}

export function createTransactionCase(t, overrides = {}, options = {}) {
  return createJournalCase(t, overrides, { ...options, publication: "collections" });
}

function splitFixtureTransaction({ sequence, mutations, result, ...request }) {
  if (sequence !== request.expectedGeneration + 1)
    throw new TypeError("Fixture sequence does not match expected generation");
  return { request, prepared: { action: "commit", mutations, result } };
}

export async function commitFixtureTransaction(transactions, input) {
  const { request, prepared } = splitFixtureTransaction(input);
  const detached = structuredClone(prepared);
  return transactions.commit(request, { validateScope: () => {}, prepare: () => detached });
}

export function encodeFixtureTransaction(input, limits) {
  const { request, prepared } = splitFixtureTransaction(input);
  const { identity } = capturePartitionTransactionRequest(request, limits);
  return createPartitionTransactionRequest(identity, prepared);
}

export function journalRequest(journal, sequence, payload = { delta: "hello" }) {
  return { epoch: journal.head.epoch, sequence, payload };
}
