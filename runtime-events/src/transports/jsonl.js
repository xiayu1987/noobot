/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import fs from "node:fs/promises";
import path from "node:path";
import { createdDirectoryDepth } from "@noobot/platform-compatibility/file-system";
import { FileMutationCoordinator } from "@noobot/shared/file-mutation-coordinator";
import {
  executionProjectionOutputRecordBytes,
  EXECUTION_PROJECTION_OUTPUT_MAX_RECEIPTS,
  executionProjectionOutputEntryBytes,
} from "@noobot/session-protocol";
import { reportRuntimeEventFailure } from "../failure-report.js";
import {
  recoverProjectionOutput,
  selectProjectionEntries,
  publishProjectionOutput,
  syncOutputDirectory as syncDirectory,
} from "./projection-output.js";

const CLEANUP_INTERVAL_MS = TIME_THRESHOLDS.runtimeEvents.cleanupIntervalMs;
const DEFAULT_BATCH_MAX_RECORDS = QUANTITY_THRESHOLDS.runtimeEvents.batchMaxRecords;
const MAX_CACHED_FILES = QUANTITY_THRESHOLDS.runtimeEvents.maxCachedFiles;
const appendQueues = new Map();
const pendingBatches = new Map();
const flushBarriers = new Set();
const directoryStates = new Map();
const syncedOutputEntries = new Map();
const cleanupTimes = new Map();
const outputMutations = new FileMutationCoordinator();

function cacheSet(cache, key, value) {
  if (!cache.has(key) && cache.size >= MAX_CACHED_FILES) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

function resolveMaxFileBytes(options = {}) {
  const value = Number(options.maxFileBytes);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function resolveNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function archiveFileName(file, date = new Date()) {
  const parsed = path.parse(file);
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return path.join(parsed.dir, `${parsed.name}.${stamp}${parsed.ext}`);
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function nextArchiveFile(file) {
  const base = archiveFileName(file);
  if (!(await pathExists(base))) return base;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = base.replace(/\.jsonl$/, `.${index}.jsonl`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Unable to allocate runtime event archive file for ${file}`);
}

async function rotateIfNeeded(file, line, state, options = {}) {
  const maxFileBytes = resolveMaxFileBytes(options);
  if (!maxFileBytes) return null;
  if (!state.exists) return null;
  if (state.bytes + Buffer.byteLength(line, "utf8") <= maxFileBytes) return null;
  const archive = await nextArchiveFile(file);
  await fs.rename(file, archive);
  state.bytes = 0;
  return archive;
}

async function readActiveFileState(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new TypeError(`Runtime event target is not a file: ${file}`);
    return {
      bytes: stat.size,
      exists: true,
      identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { bytes: 0, exists: false };
    throw error;
  }
}

async function ensureDirectory(directory) {
  let state = directoryStates.get(directory);
  if (!state) {
    trimDirectoryStates(MAX_CACHED_FILES - 1);
    if (directoryStates.size >= MAX_CACHED_FILES)
      throw Object.assign(
        new Error(
          "Runtime event directory preparation capacity exceeded; retry pending preparations",
        ),
        {
          code: "RUNTIME_EVENT_DIRECTORY_BACKPRESSURE_REQUIRED",
        },
      );
    state = { pending: null, syncDepth: null, ready: false };
    directoryStates.set(directory, state);
  }
  if (!state.pending) {
    state.pending = createDurableDirectory(directory, state).then(
      () => {
        state.ready = true;
      },
      (error) => {
        state.pending = null;
        throw error;
      },
    );
  }
  await state.pending;
  trimDirectoryStates();
}

function trimDirectoryStates(limit = MAX_CACHED_FILES) {
  for (const [directory, state] of directoryStates) {
    if (directoryStates.size <= limit) break;
    if (state.ready) directoryStates.delete(directory);
  }
}

async function createDurableDirectory(directory, state) {
  if (state.syncDepth === null) {
    const firstCreated = await fs.mkdir(directory, { recursive: true });
    if (firstCreated === undefined) return;
    state.syncDepth = createdDirectoryDepth(directory, firstCreated);
  }
  let current = path.resolve(directory);
  for (let index = 0; index <= state.syncDepth; index += 1) {
    await syncDirectory(current);
    current = path.dirname(current);
  }
}

function shouldCleanup(file, rotatedFile, options = {}) {
  if (
    !resolveNonNegativeInteger(options.retentionDays) &&
    !resolveNonNegativeInteger(options.maxArchives)
  )
    return false;
  if (rotatedFile) return true;
  const last = cleanupTimes.get(file) || 0;
  return Date.now() - last >= CLEANUP_INTERVAL_MS;
}

function enqueueAppend(file, operation) {
  const previous = appendQueues.get(file) || Promise.resolve();
  const current = previous.then(operation, operation);
  appendQueues.set(file, current);
  return current.finally(() => {
    if (appendQueues.get(file) === current) appendQueues.delete(file);
  });
}

function sameBatchOptions(left = {}, right = {}) {
  return (
    Boolean(left.projection) === Boolean(right.projection) &&
    resolveMaxFileBytes(left) === resolveMaxFileBytes(right) &&
    resolveNonNegativeInteger(left.retentionDays) ===
      resolveNonNegativeInteger(right.retentionDays) &&
    resolveNonNegativeInteger(left.maxArchives) === resolveNonNegativeInteger(right.maxArchives)
  );
}

async function appendLineBatch(file, entries = []) {
  if (!entries.length) return;
  await ensureDirectory(path.dirname(file));
  const { selected, result } = await outputMutations.run(`${file}.mutation.lock`, () =>
    appendLockedLineBatch(file, entries),
  );

  const written = new Set(selected);
  for (const entry of entries)
    entry.resolve(written.has(entry) ? result : { ok: true, duplicate: true });
}

async function appendLockedLineBatch(file, entries) {
  await recoverProjectionOutput(file);
  entries = await selectProjectionEntries(entries);
  if (!entries.length) return { selected: entries, result: null };
  const options = entries[0].options;
  const payload = entries.map((entry) => entry.line).join("");
  let rotatedFile = null;
  const state = await readActiveFileState(file);
  rotatedFile = await rotateIfNeeded(file, payload, state, options);
  if (entries.some((entry) => entry.options.projection)) {
    await publishProjectionOutput(file, entries, state.bytes);
  } else {
    await appendOrdinaryOutput(file, payload, state, rotatedFile);
  }
  let cleanup = { deletedFiles: [] };
  let cleanupError = false;
  if (shouldCleanup(file, rotatedFile, options)) {
    try {
      cleanup = await cleanupArchives(file, options);
      cacheSet(cleanupTimes, file, Date.now());
    } catch (error) {
      cleanup = { deletedFiles: [] };
      cleanupError = true;
      reportRuntimeEventFailure("archive cleanup failed", { file }, error);
    }
  }
  const result = {
    ok: true,
    file,
    rotatedFile,
    deletedFiles: cleanup.deletedFiles,
    cleanupError,
  };
  return { selected: entries, result };
}

async function appendOrdinaryOutput(file, payload, state, rotatedFile) {
  try {
    await fs.appendFile(file, payload, { encoding: "utf8", flush: true });
    if (rotatedFile || !state.exists || syncedOutputEntries.get(file) !== state.identity) {
      await syncDirectory(path.dirname(file));
      const published = rotatedFile || !state.exists ? await readActiveFileState(file) : state;
      cacheSet(syncedOutputEntries, file, published.identity);
    }
  } catch (error) {
    syncedOutputEntries.delete(file);
    throw error;
  }
}

function flushPendingBatch(file) {
  const batch = pendingBatches.get(file);
  if (!batch || batch.flushing) return batch?.flushPromise || Promise.resolve();
  pendingBatches.delete(file);
  batch.flushing = true;
  batch.flushPromise = enqueueAppend(file, () => appendOptionGroups(file, batch.entries));
  return batch.flushPromise;
}

async function appendOptionGroups(file, entries) {
  let start = 0;
  while (start < entries.length) {
    let end = start + 1;
    let bytes = entries[start].projectionBytes;
    while (
      end < entries.length &&
      sameBatchOptions(entries[start].options, entries[end].options) &&
      (!entries[start].options.projection ||
        (end - start < EXECUTION_PROJECTION_OUTPUT_MAX_RECEIPTS &&
          bytes + entries[end].projectionBytes <= executionProjectionOutputRecordBytes()))
    ) {
      bytes += entries[end].projectionBytes;
      end += 1;
    }
    await settleLineBatch(file, entries.slice(start, end));
    start = end;
  }
}

async function settleLineBatch(file, entries) {
  try {
    await appendLineBatch(file, entries);
  } catch (error) {
    for (const errors of flushBarriers) errors.add(error);
    for (const entry of entries) entry.reject(error);
  }
}

function isArchiveForActiveFile(activeFile, candidate) {
  const active = path.parse(activeFile);
  const parsed = path.parse(candidate);
  if (parsed.dir !== active.dir || parsed.ext !== active.ext) return false;
  if (parsed.base === active.base) return false;
  return parsed.name.startsWith(`${active.name}.`);
}

async function listArchiveFiles(file) {
  let entries;
  try {
    entries = await fs.readdir(path.dirname(file));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const archives = [];
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(path.dirname(file), entry);
      if (!isArchiveForActiveFile(file, fullPath)) return;
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) return;
      archives.push({ file: fullPath, mtimeMs: stat.mtimeMs });
    }),
  );
  return archives.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
}

export async function listJsonLineFilesNewestFirst(file) {
  const archives = await listArchiveFiles(file);
  return [file, ...archives.reverse().map((archive) => archive.file)];
}

async function cleanupArchives(file, options = {}) {
  const retentionDays = resolveNonNegativeInteger(options.retentionDays);
  const maxArchives = resolveNonNegativeInteger(options.maxArchives);
  if (!retentionDays && !maxArchives) return { deletedFiles: [] };
  const archives = await listArchiveFiles(file);
  const deleteSet = new Set();
  if (retentionDays) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const archive of archives.filter((entry) => entry.mtimeMs < cutoff))
      deleteSet.add(archive.file);
  }
  if (maxArchives && archives.length > maxArchives) {
    for (const archive of archives.slice(0, archives.length - maxArchives)) {
      deleteSet.add(archive.file);
    }
  }
  const deletedFiles = [];
  for (const archive of deleteSet) {
    if (await removeArchiveFile(archive)) deletedFiles.push(archive);
  }
  return { deletedFiles };
}

async function removeArchiveFile(file) {
  try {
    await fs.unlink(file);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return false;
  }
}

function scheduleGroupCommitFlush(file, batch) {
  const flush = () => {
    if (pendingBatches.get(file) === batch) void flushPendingBatch(file);
  };
  const inFlight = appendQueues.get(file);
  if (inFlight) void inFlight.then(flush, flush);
  else setImmediate(flush);
}

export function appendJsonLine(file, record, options = {}) {
  const line = `${JSON.stringify(record)}\n`;
  return new Promise((resolve, reject) => {
    const projectionBytes = options.projection
      ? executionProjectionOutputEntryBytes(line, options.projection)
      : 0;
    let batch = pendingBatches.get(file);
    if (!batch) {
      batch = { entries: [], flushing: false, flushPromise: null };
      pendingBatches.set(file, batch);
      scheduleGroupCommitFlush(file, batch);
    }
    batch.entries.push({ line, options, projectionBytes, resolve, reject });
    if (batch.entries.length >= DEFAULT_BATCH_MAX_RECORDS) void flushPendingBatch(file);
  });
}

export async function flushJsonLineBatches() {
  const errors = new Set();
  flushBarriers.add(errors);
  try {
    do {
      await Promise.all(Array.from(pendingBatches.keys(), (file) => flushPendingBatch(file)));
      await Promise.all(Array.from(appendQueues.values()));
    } while (pendingBatches.size > 0 || appendQueues.size > 0);
    if (errors.size) throw new AggregateError(errors, "Runtime event flush failed");
  } finally {
    flushBarriers.delete(errors);
  }
}
