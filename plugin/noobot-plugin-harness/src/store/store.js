/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HARNESS_FILES, HARNESS_FLUSH_REASONS, HARNESS_TERMINAL_RUN_STATUSES } from "../core/constants.js";
import { DEFAULT_OPTIONS } from "../core/options.js";
import { ensureIntervalCleanupTask } from "../utils/cleanup-scheduler.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

// ---- Manifest Cache & Debounce ----
const manifestCache = new Map();
const manifestWriteTimers = new Map();
const manifestLastAccessed = new Map(); // Track last access time for LRU cleanup

const MANIFEST_CACHE_MAX_AGE_MS = TIME_THRESHOLDS.harness.manifestCacheMaxAgeMs;
const MANIFEST_CLEANUP_INTERVAL_MS = TIME_THRESHOLDS.harness.manifestCleanupIntervalMs;

function cleanupStaleManifests() {
  const now = Date.now();
  for (const [key, lastAccess] of manifestLastAccessed.entries()) {
    if (now - lastAccess > MANIFEST_CACHE_MAX_AGE_MS) {
      // Flush stale entry
      const timer = manifestWriteTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        manifestWriteTimers.delete(key);
      }
      const cached = manifestCache.get(key);
      if (cached) {
        writeJsonValidated(key, cached)
          .then(() => {
            manifestCache.delete(key);
            manifestLastAccessed.delete(key);
          })
          .catch((err) => {
            console.warn(`[harness] Manifest cleanup write failed for ${key}: ${err.message}`);
          });
        continue;
      }
      manifestCache.delete(key);
      manifestLastAccessed.delete(key);
    }
  }
}

ensureIntervalCleanupTask(
  "harness_manifest_cache_cleanup",
  cleanupStaleManifests,
  MANIFEST_CLEANUP_INTERVAL_MS,
);

/**
 * Update manifest with memory cache + debounced write.
 * Terminal states (success/error/abort) flush immediately.
 */
export async function updateManifestCached(
  paths,
  ctx,
  patch,
  options,
  capabilityRuntime,
  mergeFn,
  debounceMs = TIME_THRESHOLDS.harness.manifestDebounceMs,
) {
  if (!paths?.manifest) return;
  const key = paths.manifest;
  manifestLastAccessed.set(key, Date.now()); // P0#2: Track access time
  let current = manifestCache.get(key);
  if (!current) {
    try {
      current = await readJson(key, {});
    } catch {
      current = {};
    }
  }

  const next = mergeFn(current, ctx, patch, options, capabilityRuntime);
  manifestCache.set(key, next);

  // Clear existing timer
  const existingTimer = manifestWriteTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const isTerminal = HARNESS_TERMINAL_RUN_STATUSES.has(String(patch.status || ""));

  if (isTerminal) {
    // Flush immediately for terminal states
    clearTimeout(manifestWriteTimers.get(key));
    manifestWriteTimers.delete(key);
    await writeJsonValidated(key, next);
    manifestCache.delete(key);
    manifestLastAccessed.delete(key);
  } else if (debounceMs > 0) {
    manifestWriteTimers.set(
      key,
      setTimeout(async () => {
        const cached = manifestCache.get(key);
        if (cached) {
          try {
            await writeJsonValidated(key, cached);
            manifestCache.delete(key);
            manifestLastAccessed.delete(key);
          } catch (err) {
            console.warn(`[harness] Manifest debounced write failed for ${key}: ${err.message}`);
          }
        }
        manifestWriteTimers.delete(key);
      }, debounceMs),
    );
  } else {
    await writeJsonValidated(key, next);
    manifestCache.delete(key);
    manifestLastAccessed.delete(key);
  }
}

/**
 * Flush all pending manifest writes immediately.
 */
export async function flushAllManifests() {
  const entries = Array.from(manifestCache.entries());
  for (const [key, value] of entries) {
    const timer = manifestWriteTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      manifestWriteTimers.delete(key);
    }
    try {
      await writeJsonValidated(key, value);
      manifestCache.delete(key);
      manifestLastAccessed.delete(key);
    } catch (err) {
      console.error(`[harness] Failed to flush manifest ${key}:`, err.message); // P2#7
    }
  }
}

// ---- JSONL Buffer ----
const jsonlBuffers = new Map(); // filePath -> string[]
const jsonlFlushTimers = new Map(); // filePath -> Timer

const DEFAULT_JSONL_BATCH_SIZE = DEFAULT_OPTIONS.jsonlBatchSize;
const DEFAULT_JSONL_FLUSH_INTERVAL_MS = DEFAULT_OPTIONS.jsonlFlushIntervalMs;
const DEFAULT_JSONL_FLUSH_STRATEGY = DEFAULT_OPTIONS.jsonlFlushStrategy;
const JSONL_RETRY_BASE_DELAY_MS = TIME_THRESHOLDS.harness.jsonlRetryBaseDelayMs;
const JSONL_RETRY_MAX_DELAY_MS = TIME_THRESHOLDS.harness.jsonlRetryMaxDelayMs;
const jsonlFlushFailures = new Map(); // filePath -> number
const jsonlFlushStrategies = new Map(); // filePath -> strategy
const tmpCleanupLastRunByFile = new Map(); // filePath -> timestamp
const runWriteLockRefCounts = new Map(); // runDir -> count
const TMP_FILE_MAX_AGE_MS = TIME_THRESHOLDS.harness.tmpFileMaxAgeMs;
const TMP_CLEANUP_MIN_INTERVAL_MS = TIME_THRESHOLDS.harness.tmpCleanupMinIntervalMs;

function resolveRunWriteLockPath(targetPath = "") {
  const dir = path.dirname(String(targetPath || "").trim());
  if (!dir || dir === ".") return "";
  return path.join(dir, HARNESS_FILES.RUN_WRITE_LOCK);
}

async function withRunWriteLock(targetPath = "", operation = async () => undefined) {
  const lockPath = resolveRunWriteLockPath(targetPath);
  if (!lockPath) return operation();
  const runDir = path.dirname(lockPath);
  const current = Number(runWriteLockRefCounts.get(runDir) || 0);
  if (current <= 0) {
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(lockPath, String(Date.now()), "utf-8");
  }
  runWriteLockRefCounts.set(runDir, current + 1);
  try {
    return await operation();
  } finally {
    const next = Number(runWriteLockRefCounts.get(runDir) || 1) - 1;
    if (next > 0) {
      runWriteLockRefCounts.set(runDir, next);
      return;
    }
    runWriteLockRefCounts.delete(runDir);
    await fs.unlink(lockPath).catch(() => {});
  }
}

function normalizeFlushStrategy(batchSize, flushIntervalMs) {
  if (batchSize && typeof batchSize === "object" && !Array.isArray(batchSize)) {
    const input = batchSize;
    const maxSize = Number(input?.maxSize);
    const maxTime = Number(input?.maxTime);
    const maxRetry = Number(input?.maxRetry);
    const maxBufferEntries = Number(input?.maxBufferEntries);
    const maxBufferBytes = Number(input?.maxBufferBytes);
    const maxFileBytes = Number(input?.maxFileBytes);
    const maxFiles = Number(input?.maxFiles);
    return {
      maxSize: Number.isFinite(maxSize) && maxSize > 0 ? maxSize : DEFAULT_JSONL_FLUSH_STRATEGY.maxSize,
      maxTime: Number.isFinite(maxTime) && maxTime >= 0 ? maxTime : DEFAULT_JSONL_FLUSH_STRATEGY.maxTime,
      onTerminal:
        typeof input?.onTerminal === "boolean"
          ? input.onTerminal
          : DEFAULT_JSONL_FLUSH_STRATEGY.onTerminal,
      onError: typeof input?.onError === "boolean" ? input.onError : DEFAULT_JSONL_FLUSH_STRATEGY.onError,
      maxRetry:
        Number.isFinite(maxRetry) && maxRetry >= 0
          ? Math.trunc(maxRetry)
          : DEFAULT_JSONL_FLUSH_STRATEGY.maxRetry,
      maxBufferEntries:
        Number.isFinite(maxBufferEntries) && maxBufferEntries > 0
          ? Math.trunc(maxBufferEntries)
          : DEFAULT_JSONL_FLUSH_STRATEGY.maxBufferEntries,
      maxBufferBytes:
        Number.isFinite(maxBufferBytes) && maxBufferBytes > 0
          ? Math.trunc(maxBufferBytes)
          : DEFAULT_JSONL_FLUSH_STRATEGY.maxBufferBytes,
      maxFileBytes:
        Number.isFinite(maxFileBytes) && maxFileBytes >= 0
          ? Math.trunc(maxFileBytes)
          : DEFAULT_JSONL_FLUSH_STRATEGY.maxFileBytes,
      maxFiles:
        Number.isFinite(maxFiles) && maxFiles >= 0
          ? Math.trunc(maxFiles)
          : DEFAULT_JSONL_FLUSH_STRATEGY.maxFiles,
    };
  }
  const resolvedBatch = Number(batchSize);
  const resolvedInterval = Number(flushIntervalMs);
  return {
    maxSize: Number.isFinite(resolvedBatch) && resolvedBatch > 0 ? resolvedBatch : DEFAULT_JSONL_BATCH_SIZE,
    maxTime:
      Number.isFinite(resolvedInterval) && resolvedInterval >= 0
        ? resolvedInterval
        : DEFAULT_JSONL_FLUSH_INTERVAL_MS,
    onTerminal: DEFAULT_JSONL_FLUSH_STRATEGY.onTerminal,
    onError: DEFAULT_JSONL_FLUSH_STRATEGY.onError,
    maxRetry: DEFAULT_JSONL_FLUSH_STRATEGY.maxRetry,
    maxBufferEntries: DEFAULT_JSONL_FLUSH_STRATEGY.maxBufferEntries,
    maxBufferBytes: DEFAULT_JSONL_FLUSH_STRATEGY.maxBufferBytes,
    maxFileBytes: DEFAULT_JSONL_FLUSH_STRATEGY.maxFileBytes,
    maxFiles: DEFAULT_JSONL_FLUSH_STRATEGY.maxFiles,
  };
}

function clearJsonlFlushTimer(filePath = "") {
  const timer = jsonlFlushTimers.get(filePath);
  if (timer) clearTimeout(timer);
  jsonlFlushTimers.delete(filePath);
}

function scheduleJsonlFlush(
  filePath = "",
  maxTime = DEFAULT_JSONL_FLUSH_INTERVAL_MS,
  strategy = DEFAULT_JSONL_FLUSH_STRATEGY,
) {
  if (!filePath || jsonlFlushTimers.has(filePath) || maxTime <= 0) return;
  jsonlFlushTimers.set(
    filePath,
    setTimeout(async () => {
      await flushJsonlBuffer(filePath, strategy);
      jsonlFlushTimers.delete(filePath);
    }, maxTime),
  );
}

function computeJsonlRetryDelayMs(retries = 1) {
  const cappedRetries = Math.max(1, Number(retries) || 1);
  const backoff = Math.min(JSONL_RETRY_MAX_DELAY_MS, JSONL_RETRY_BASE_DELAY_MS * 2 ** (cappedRetries - 1));
  const jitterFactor = 0.5 + Math.random();
  return Math.max(50, Math.round(backoff * jitterFactor));
}

function scheduleJsonlRetry(filePath = "", strategy = DEFAULT_JSONL_FLUSH_STRATEGY, retries = 1) {
  if (!filePath) return;
  const delayMs = computeJsonlRetryDelayMs(retries);
  clearJsonlFlushTimer(filePath);
  jsonlFlushTimers.set(
    filePath,
    setTimeout(async () => {
      await flushJsonlBuffer(filePath, strategy);
      jsonlFlushTimers.delete(filePath);
    }, delayMs),
  );
}

function estimateUtf8Bytes(text = "") {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function calculateJsonlBufferBytes(buffer = []) {
  if (!Array.isArray(buffer) || !buffer.length) return 0;
  return buffer.reduce((sum, line) => sum + estimateUtf8Bytes(line), 0);
}

function trimJsonlBuffer(filePath = "", buffer = [], strategy = DEFAULT_JSONL_FLUSH_STRATEGY) {
  if (!filePath || !Array.isArray(buffer)) return buffer;
  const maxEntries = Number(strategy?.maxBufferEntries);
  if (Number.isFinite(maxEntries) && maxEntries > 0 && buffer.length > maxEntries) {
    const dropped = buffer.length - maxEntries;
    buffer.splice(0, dropped);
    console.warn(
      `[harness] JSONL buffer capped by entries for ${filePath}; dropped ${dropped} oldest record(s) to avoid OOM`,
    );
  }
  const maxBytes = Number(strategy?.maxBufferBytes);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !buffer.length) return buffer;
  const currentBytes = calculateJsonlBufferBytes(buffer);
  if (currentBytes <= maxBytes) return buffer;
  let droppedEntries = 0;
  let droppedBytes = 0;
  for (const line of buffer) {
    droppedEntries += 1;
    droppedBytes += estimateUtf8Bytes(line);
    if (currentBytes - droppedBytes <= maxBytes) break;
  }
  if (droppedEntries > 0) {
    buffer.splice(0, droppedEntries);
    console.warn(
      `[harness] JSONL buffer capped by bytes for ${filePath}; dropped ${droppedEntries} oldest record(s), reclaimed ${droppedBytes} bytes`,
    );
  }
  return buffer;
}

async function cleanupStaleTmpFilesForTarget(filePath = "", { force = false } = {}) {
  const targetPath = String(filePath || "").trim();
  if (!targetPath) return 0;
  const now = Date.now();
  const last = Number(tmpCleanupLastRunByFile.get(targetPath) || 0);
  if (!force && now - last < TMP_CLEANUP_MIN_INTERVAL_MS) return 0;
  tmpCleanupLastRunByFile.set(targetPath, now);
  const dir = path.dirname(targetPath);
  const prefix = `${path.basename(targetPath)}.tmp.`;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry?.isFile?.() || !String(entry.name || "").startsWith(prefix)) continue;
    const tmpPath = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(tmpPath);
      if (now - Number(stat?.mtimeMs || 0) <= TMP_FILE_MAX_AGE_MS) continue;
      await fs.unlink(tmpPath);
      removed += 1;
    } catch {
      // ignore cleanup failures for best-effort stale temp cleanup
    }
  }
  if (removed > 0) {
    console.warn(`[harness] Cleaned ${removed} stale tmp file(s) near ${targetPath}`);
  }
  return removed;
}

/**
 * Append to JSONL buffer. Flushes when batch size reached or on interval.
 */
export async function appendJsonlBuffered(
  filePath,
  record,
  batchSize = DEFAULT_JSONL_BATCH_SIZE,
  flushIntervalMs = DEFAULT_JSONL_FLUSH_INTERVAL_MS,
  flushHint = {},
) {
  if (!filePath || !record) return;
  const strategy = normalizeFlushStrategy(batchSize, flushIntervalMs);
  jsonlFlushStrategies.set(filePath, strategy);

  let buffer = jsonlBuffers.get(filePath);
  if (!buffer) {
    buffer = [];
    jsonlBuffers.set(filePath, buffer);
  }

  buffer.push(JSON.stringify(record));
  trimJsonlBuffer(filePath, buffer, strategy);

  const reason = String(flushHint?.reason || "").trim().toLowerCase();
  const shouldFlushByReason =
    (reason === HARNESS_FLUSH_REASONS.TERMINAL && strategy.onTerminal) ||
    (reason === HARNESS_FLUSH_REASONS.ERROR && strategy.onError);

  if (buffer.length >= strategy.maxSize || shouldFlushByReason) {
    clearJsonlFlushTimer(filePath);
    await flushJsonlBuffer(filePath, strategy);
  } else {
    scheduleJsonlFlush(filePath, strategy.maxTime, strategy);
  }
}

/**
 * Flush a single JSONL buffer to disk.
 * P0#1: Fixed race condition using atomic swap pattern.
 */
async function flushJsonlBuffer(filePath, strategy = DEFAULT_JSONL_FLUSH_STRATEGY) {
  const buffer = jsonlBuffers.get(filePath);
  if (!buffer || buffer.length === 0) return;

  // P0#1: Atomic swap - extract current buffer, replace with new empty array immediately
  const lines = buffer.join("\n") + "\n";
  const newBuffer = [];
  jsonlBuffers.set(filePath, newBuffer); // Atomically replace with new empty buffer

  try {
    await appendFileValidated(filePath, lines, strategy);
    jsonlFlushFailures.delete(filePath);
    const current = jsonlBuffers.get(filePath);
    if (Array.isArray(current) && current.length === 0) {
      jsonlBuffers.delete(filePath);
      jsonlFlushStrategies.delete(filePath);
    }
  } catch (err) {
    // P2#7: Log the error
    console.error(`[harness] JSONL flush failed for ${filePath}:`, err.message);
    const retries = Number(jsonlFlushFailures.get(filePath) || 0) + 1;
    jsonlFlushFailures.set(filePath, retries);
    // P0#1: On failure, merge the extracted buffer INTO the new buffer (which may have new entries)
    // Prepend old data so it gets retried first, but preserve any new records that arrived during write
    const current = jsonlBuffers.get(filePath) || [];
    const merged = [...buffer, ...current];
    trimJsonlBuffer(filePath, merged, strategy);
    const maxRetry = Number(strategy?.maxRetry);
    if (Number.isFinite(maxRetry) && retries > maxRetry) {
      console.error(
        `[harness] JSONL flush exceeded retry limit for ${filePath}; dropped ${merged.length} buffered record(s)`,
      );
      jsonlBuffers.delete(filePath);
      jsonlFlushFailures.delete(filePath);
      clearJsonlFlushTimer(filePath);
      return;
    }
    jsonlBuffers.set(filePath, merged);
    scheduleJsonlRetry(filePath, strategy, retries);
  }
}

/**
 * Flush all JSONL buffers immediately.
 */
export async function flushAllJsonlBuffers() {
  const filePaths = Array.from(jsonlBuffers.keys());
  for (const filePath of filePaths) {
    clearJsonlFlushTimer(filePath);
    await flushJsonlBuffer(filePath, jsonlFlushStrategies.get(filePath) || DEFAULT_JSONL_FLUSH_STRATEGY);
  }
}

// ---- Basic JSON read/write with validation ----
export async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, data) {
  await writeJsonValidated(filePath, data);
}

/**
 * P1#4: Optimized JSON write - atomic write with temp file + rename.
 * Falls back to read-back validation only in dev mode or on first failure.
 */
async function writeJsonValidated(filePath, data, devMode = false) {
  const content = JSON.stringify(data, null, 2);
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  await withRunWriteLock(filePath, async () => {
    await fs.mkdir(dir, { recursive: true });
    await cleanupStaleTmpFilesForTarget(filePath);

    // Atomic write: write to temp file, then rename
    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);

    // P1#4: Only validate in dev mode or if explicitly requested
    if (devMode || process.env.HARNESS_VALIDATE_WRITES === "1") {
      try {
        const written = await fs.readFile(filePath, "utf-8");
        JSON.parse(written);
      } catch (err) {
        console.error(`[harness] JSON validation failed for ${filePath}:`, err.message); // P2#7
        // Fallback: try writing again
        await fs.writeFile(filePath, content, "utf-8");
      }
    }
  });
}

export async function appendJsonl(filePath, record) {
  const line = JSON.stringify(record) + "\n";
  await appendFileValidated(filePath, line);
}

function buildRotatedJsonlPath(filePath = "") {
  const parsed = path.parse(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 6);
  return path.join(parsed.dir, `${parsed.name}.${stamp}.${suffix}${parsed.ext || ".jsonl"}`);
}

function isRotatedJsonlForFile(entryName = "", filePath = "") {
  const parsed = path.parse(filePath);
  const ext = parsed.ext || ".jsonl";
  return String(entryName || "").startsWith(`${parsed.name}.`) && String(entryName || "").endsWith(ext);
}

async function pruneRotatedJsonlFiles(filePath = "", maxFiles = 0) {
  const keep = Number(maxFiles);
  if (!Number.isFinite(keep) || keep <= 0) return;
  const dir = path.dirname(filePath);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const rotated = [];
  for (const entry of entries) {
    if (!entry?.isFile?.() || !isRotatedJsonlForFile(entry.name, filePath)) continue;
    const rotatedPath = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(rotatedPath);
      rotated.push({ path: rotatedPath, mtimeMs: Number(stat?.mtimeMs || 0) });
    } catch {
      // best-effort pruning
    }
  }
  if (rotated.length <= keep) return;
  rotated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of rotated.slice(keep)) {
    await fs.unlink(item.path).catch(() => {});
  }
}

async function rotateJsonlIfNeeded(filePath = "", content = "", strategy = DEFAULT_JSONL_FLUSH_STRATEGY) {
  const maxFileBytes = Number(strategy?.maxFileBytes);
  if (!Number.isFinite(maxFileBytes) || maxFileBytes <= 0) return;
  let currentSize = 0;
  try {
    const stat = await fs.stat(filePath);
    currentSize = Number(stat?.size || 0);
  } catch {
    return;
  }
  if (currentSize <= 0 || currentSize + estimateUtf8Bytes(content) <= maxFileBytes) return;
  await fs.rename(filePath, buildRotatedJsonlPath(filePath));
  await pruneRotatedJsonlFiles(filePath, strategy?.maxFiles);
}

async function appendFileValidated(filePath, content, strategy = null) {
  await withRunWriteLock(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (strategy) await rotateJsonlIfNeeded(filePath, content, strategy);
    await fs.appendFile(filePath, content, "utf-8");
  });
}
