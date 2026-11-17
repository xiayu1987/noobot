/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { IMMUTABLE_CHECKPOINT_FORBIDDEN_WORK } from "@noobot/session-protocol/immutable-storage";

const transactions = new AsyncLocalStorage();
const observations = new AsyncLocalStorage();

export async function withSessionStorageTransaction(sessionDir, operation) {
  const directory = path.resolve(sessionDir);
  const current = transactions.getStore();
  if (current?.active && current.directory === directory) return operation();
  const transaction = { directory, active: true, reads: new Map(), paths: new Map(), token: {} };
  try {
    return await transactions.run(transaction, operation);
  } finally {
    transaction.active = false;
    transaction.reads.clear();
    transaction.paths.clear();
  }
}

function resolveTransactionPath(transaction, file) {
  const pathKey = path.isAbsolute(file) ? file : `${process.cwd()}\0${file}`;
  let absolute = transaction.paths.get(pathKey);
  if (absolute === undefined) {
    absolute = path.resolve(file);
    transaction.paths.set(pathKey, absolute);
  }
  return absolute;
}

export function artifactReadToken() {
  const transaction = transactions.getStore();
  if (!transaction?.active) return undefined;
  return transaction.token;
}

export function memoizeArtifactRead(tier, file, read) {
  const transaction = transactions.getStore();
  if (!transaction?.active) return read();
  const absolute = resolveTransactionPath(transaction, file);
  if (!absolute.startsWith(`${transaction.directory}${path.sep}`)) return read();
  let reads = transaction.reads.get(absolute);
  if (!reads) {
    reads = new Map();
    transaction.reads.set(absolute, reads);
  }
  if (!reads.has(tier)) reads.set(tier, Promise.resolve().then(read));
  return reads.get(tier);
}

export function invalidateArtifactRead(file) {
  const transaction = transactions.getStore();
  if (transaction?.active && transaction.reads.delete(resolveTransactionPath(transaction, file)))
    transaction.token = {};
}

export function recordStorageWork(name, amount = 1) {
  const work = observations.getStore();
  if (work) work[name] = (work[name] || 0) + amount;
}

export async function observeSessionStorageWork(operation) {
  const work = Object.fromEntries(IMMUTABLE_CHECKPOINT_FORBIDDEN_WORK.map((name) => [name, 0]));
  const result = await observations.run(work, operation);
  return { result, work };
}
