/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import fs from "node:fs/promises";
import path from "node:path";
import { reportRuntimeEventFailure } from "../failure-report.js";

const CLEANUP_INTERVAL_MS = TIME_THRESHOLDS.runtimeEvents.cleanupIntervalMs;
const DEFAULT_BATCH_FLUSH_MS = TIME_THRESHOLDS.runtimeEvents.batchFlushMs;
const DEFAULT_BATCH_MAX_RECORDS = QUANTITY_THRESHOLDS.runtimeEvents.batchMaxRecords;
const MAX_CACHED_FILES = QUANTITY_THRESHOLDS.runtimeEvents.maxCachedFiles;
const appendQueues = new Map();
const pendingBatches = new Map();
const directoryPromises = new Map();
const activeFileStates = new Map();
const cleanupTimes = new Map();

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

async function rotateIfNeeded(file, line, options = {}) {
  const maxFileBytes = resolveMaxFileBytes(options);
  if (!maxFileBytes) return null;
  let state = activeFileStates.get(file);
  if (!state) {
    state = await readActiveFileState(file);
    if (state === null) return null;
    cacheSet(activeFileStates, file, state);
  }
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
    if (!stat.isFile()) return null;
    return { bytes: stat.size, exists: true };
  } catch (error) {
    if (error.code === "ENOENT") return { bytes: 0, exists: false };
    throw error;
  }
}

async function ensureDirectory(directory) {
  let pending = directoryPromises.get(directory);
  if (!pending) {
    pending = fs.mkdir(directory, { recursive: true });
    cacheSet(directoryPromises, directory, pending);
  }
  try {
    await pending;
  } catch (error) {
    if (directoryPromises.get(directory) === pending) directoryPromises.delete(directory);
    throw error;
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
    resolveMaxFileBytes(left) === resolveMaxFileBytes(right) &&
    resolveNonNegativeInteger(left.retentionDays) ===
      resolveNonNegativeInteger(right.retentionDays) &&
    resolveNonNegativeInteger(left.maxArchives) === resolveNonNegativeInteger(right.maxArchives)
  );
}

async function appendLineBatch(file, entries = []) {
  if (!entries.length) return;
  await ensureDirectory(path.dirname(file));
  const options = entries[0].options;
  const payload = entries.map((entry) => entry.line).join("");
  let rotatedFile = null;
  try {
    rotatedFile = await rotateIfNeeded(file, payload, options);
    await fs.appendFile(file, payload, "utf8");
    const state = activeFileStates.get(file);
    if (state) {
      state.bytes += Buffer.byteLength(payload, "utf8");
      state.exists = true;
    }
  } catch (error) {
    activeFileStates.delete(file);
    throw error;
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
  for (const entry of entries) entry.resolve(result);
}

function flushPendingBatch(file) {
  const batch = pendingBatches.get(file);
  if (!batch || batch.flushing) return batch?.flushPromise || Promise.resolve();
  pendingBatches.delete(file);
  batch.flushing = true;
  if (batch.timer) clearTimeout(batch.timer);
  batch.flushPromise = enqueueAppend(file, () => appendOptionGroups(file, batch.entries));
  return batch.flushPromise;
}

async function appendOptionGroups(file, entries) {
  let start = 0;
  while (start < entries.length) {
    let end = start + 1;
    while (end < entries.length && sameBatchOptions(entries[start].options, entries[end].options))
      end += 1;
    await settleLineBatch(file, entries.slice(start, end));
    start = end;
  }
}

async function settleLineBatch(file, entries) {
  try {
    await appendLineBatch(file, entries);
  } catch (error) {
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
    try {
      await fs.unlink(archive);
      deletedFiles.push(archive);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { deletedFiles };
}

export function appendJsonLine(file, record, options = {}) {
  const line = `${JSON.stringify(record)}\n`;
  return new Promise((resolve, reject) => {
    let batch = pendingBatches.get(file);
    if (!batch) {
      batch = { entries: [], timer: null, flushing: false, flushPromise: null };
      pendingBatches.set(file, batch);
      batch.timer = setTimeout(() => flushPendingBatch(file), DEFAULT_BATCH_FLUSH_MS);
    }
    batch.entries.push({ line, options, resolve, reject });
    if (batch.entries.length >= DEFAULT_BATCH_MAX_RECORDS) void flushPendingBatch(file);
  });
}

export async function flushJsonLineBatches() {
  await Promise.all(Array.from(pendingBatches.keys(), (file) => flushPendingBatch(file)));
  await Promise.all(Array.from(appendQueues.values()));
}
