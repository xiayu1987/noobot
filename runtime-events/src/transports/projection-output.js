/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  EXECUTION_PROJECTION_PENDING_SUFFIX,
  executionProjectionOutputRecordBytes,
  encodeExecutionProjectionOutputRecord,
  decodeExecutionProjectionOutputRecord,
  compareExecutionProjectionSources,
  requireExecutionProjectionIntent,
  requireExecutionProjectionReceipt,
  executionProjectionPendingReceipts,
} from "@noobot/session-protocol";

const pendingDirectorySyncs = new Map();

async function withOutputHandle(handle, operation) {
  const errors = [];
  let result;
  try {
    result = await operation(handle);
  } catch (error) {
    errors.push(error);
  }
  try {
    await handle.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Projection output operation and close failed", {
      cause: errors[0],
    });
  return result;
}

export function syncOutputDirectory(directory) {
  directory = path.resolve(directory);
  const pending = pendingDirectorySyncs.get(directory);
  if (pending) return pending;
  const { promise, resolve, reject } = Promise.withResolvers();
  pendingDirectorySyncs.set(directory, promise);
  setImmediate(() => {
    pendingDirectorySyncs.delete(directory);
    fs.open(directory, "r")
      .then((handle) => withOutputHandle(handle, (opened) => opened.sync()))
      .then(resolve, reject);
  });
  return promise;
}

async function readOptional(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return withOutputHandle(handle, async (opened) => {
    const stat = await opened.stat();
    if (stat.size > executionProjectionOutputRecordBytes())
      throw new RangeError("Projection output record exceeds its byte budget");
    return decodeExecutionProjectionOutputRecord(await opened.readFile());
  });
}

async function prepareRecord(file, value) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, encodeExecutionProjectionOutputRecord(value), {
    encoding: "utf8",
    flush: true,
  });
}

async function replaceRecord(file, value) {
  await prepareRecord(file, value);
  const temporary = `${file}.tmp`;
  await fs.rename(temporary, file);
}

async function settleOutputOperations(operations) {
  const results = await Promise.allSettled(operations);
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Projection output publication failed");
}

async function readReceipt(file) {
  const value = await readOptional(file);
  return value === null ? null : requireExecutionProjectionReceipt(value);
}

export async function recoverProjectionOutput(file) {
  const pending = `${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`;
  const value = await readOptional(pending);
  if (value === null) return false;
  const intent = requireExecutionProjectionIntent(value);
  const currentReceipts = [];
  for (const receipt of intent.receipts) currentReceipts.push(await readReceipt(receipt.file));
  const unconfirmed = executionProjectionPendingReceipts(intent, currentReceipts);
  await completeProjectionOutput(file, intent, unconfirmed, async () => {
    await withOutputHandle(await fs.open(file, "a+"), async (handle) => {
      await syncOutputDirectory(path.dirname(file));
      await completeProjectionBytes(handle, intent);
    });
  });
  return true;
}

async function completeProjectionOutput(file, intent, unconfirmed, writeOutput) {
  const pending = `${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`;
  if (unconfirmed.length) {
    await settleOutputOperations([
      writeOutput(),
      ...unconfirmed.map((receipt) =>
        prepareRecord(receipt.file, { version: 1, sourceId: receipt.sourceId }),
      ),
    ]);
    await settleOutputOperations(
      unconfirmed.map((receipt) => fs.rename(`${receipt.file}.tmp`, receipt.file)),
    );
  }

  const directories = new Set(intent.receipts.map((receipt) => path.dirname(receipt.file)));
  await settleOutputOperations([...directories].map(syncOutputDirectory));
  await fs.unlink(pending);
}

async function completeProjectionBytes(handle, intent) {
  const payload = Buffer.from(intent.payload, "utf8");
  const stat = await handle.stat();
  if (stat.size < intent.offset || stat.size > intent.offset + payload.length)
    throw new Error("Projection output is outside its pending write boundary");
  const present = Buffer.alloc(stat.size - intent.offset);
  let position = 0;
  while (position < present.length) {
    const { bytesRead } = await handle.read(
      present,
      position,
      present.length - position,
      intent.offset + position,
    );
    if (!bytesRead) throw new Error("Projection output ended inside pending bytes");
    position += bytesRead;
  }
  if (!present.equals(payload.subarray(0, present.length)))
    throw new Error("Projection output differs from its durable intent");
  if (present.length < payload.length) await handle.writeFile(payload.subarray(present.length));
  await handle.sync();
}

export async function selectProjectionEntries(entries) {
  const receipts = new Map();
  const selected = [];
  const admitted = new Map();
  for (const entry of entries) {
    const projection = entry.options.projection;
    if (!projection) {
      selected.push(entry);
      continue;
    }
    const previous = admitted.get(projection.file);
    if (previous && compareExecutionProjectionSources(projection.sourceId, previous) <= 0)
      throw new TypeError("Projection batch must preserve strict source order");
    admitted.set(projection.file, projection.sourceId);
    if (!receipts.has(projection.file))
      receipts.set(projection.file, await readReceipt(projection.file));
    const receipt = receipts.get(projection.file);
    if (receipt && compareExecutionProjectionSources(projection.sourceId, receipt.sourceId) <= 0) {
      continue;
    }
    selected.push(entry);
  }
  return selected;
}

export async function publishProjectionOutput(file, entries, offset) {
  const receipts = new Map();
  for (const { options } of entries) {
    if (options.projection) receipts.set(options.projection.file, options.projection);
  }
  const intent = requireExecutionProjectionIntent({
    version: 1,
    offset,
    payload: entries.map(({ line }) => line).join(""),
    receipts: [...receipts.values()],
  });
  await withOutputHandle(await fs.open(file, "a+"), async (handle) => {
    await replaceRecord(`${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`, intent);
    await syncOutputDirectory(path.dirname(file));
    await completeProjectionOutput(file, intent, intent.receipts, () =>
      completeProjectionBytes(handle, intent),
    );
  });
}
