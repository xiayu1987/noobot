/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ensureIntervalCleanupTask } from "../utils/cleanup-scheduler.js";

// ---- Manifest Cache & Debounce ----
const manifestCache = new Map();
const manifestWriteTimers = new Map();
const manifestLastAccessed = new Map(); // Track last access time for LRU cleanup

const MANIFEST_CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const MANIFEST_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

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
  debounceMs = 500,
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

  const isTerminal = ["success", "error", "abort"].includes(String(patch.status || ""));

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

const DEFAULT_JSONL_BATCH_SIZE = 50;
const DEFAULT_JSONL_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_JSONL_FLUSH_STRATEGY = Object.freeze({
  maxSize: DEFAULT_JSONL_BATCH_SIZE,
  maxTime: DEFAULT_JSONL_FLUSH_INTERVAL_MS,
  onTerminal: true,
  onError: true,
  maxRetry: 5,
  maxBufferEntries: 5000,
});
const jsonlFlushFailures = new Map(); // filePath -> number
const jsonlFlushStrategies = new Map(); // filePath -> strategy

function normalizeFlushStrategy(batchSize, flushIntervalMs) {
  if (batchSize && typeof batchSize === "object" && !Array.isArray(batchSize)) {
    const input = batchSize;
    const maxSize = Number(input?.maxSize);
    const maxTime = Number(input?.maxTime);
    const maxRetry = Number(input?.maxRetry);
    const maxBufferEntries = Number(input?.maxBufferEntries);
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
    onTerminal: true,
    onError: true,
    maxRetry: DEFAULT_JSONL_FLUSH_STRATEGY.maxRetry,
    maxBufferEntries: DEFAULT_JSONL_FLUSH_STRATEGY.maxBufferEntries,
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

function trimJsonlBuffer(filePath = "", buffer = [], strategy = DEFAULT_JSONL_FLUSH_STRATEGY) {
  if (!filePath || !Array.isArray(buffer)) return buffer;
  const limit = Number(strategy?.maxBufferEntries);
  if (!Number.isFinite(limit) || limit <= 0 || buffer.length <= limit) return buffer;
  const dropped = buffer.length - limit;
  buffer.splice(0, dropped);
  console.warn(
    `[harness] JSONL buffer capped for ${filePath}; dropped ${dropped} oldest record(s) to avoid OOM`,
  );
  return buffer;
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
    (reason === "terminal" && strategy.onTerminal) || (reason === "error" && strategy.onError);

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
    await appendFileValidated(filePath, lines);
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

  await fs.mkdir(dir, { recursive: true });

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
}

export async function appendJsonl(filePath, record) {
  const line = JSON.stringify(record) + "\n";
  await appendFileValidated(filePath, line);
}

async function appendFileValidated(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, content, "utf-8");
}
