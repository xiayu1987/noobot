/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { runBestEffort } from "@noobot/shared/best-effort";
import path from "node:path";
import {
  HARNESS_FILES,
  HARNESS_FLUSH_REASONS,
  HARNESS_TERMINAL_RUN_STATUSES,
} from "../core/constants.js";
import { createHarnessJsonlFlushStrategySchema } from "../core/options.js";
import { ensureIntervalCleanupTask } from "../utils/cleanup-scheduler.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { randomUUID } from "node:crypto";
import { isPlainObject, text } from "@noobot/shared/value";

const manifestCache = new Map();
const manifestWriteTimers = new Map();
const manifestLastAccessed = new Map();

function cleanupStaleManifests() {
  const now = Date.now();
  for (const [key, lastAccess] of manifestLastAccessed.entries()) {
    if (now - lastAccess <= TIME_THRESHOLDS.harness.manifestCacheMaxAgeMs) continue;
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
  ensureIntervalCleanupTask(
    "harness_manifest_cache_cleanup",
    cleanupStaleManifests,
    TIME_THRESHOLDS.harness.manifestCleanupIntervalMs,
  );
  manifestLastAccessed.set(key, Date.now());
  let current = manifestCache.get(key);
  if (!current) current = await readJson(key, {});

  const next = mergeFn(current, ctx, patch, options, capabilityRuntime);
  manifestCache.set(key, next);

  const existingTimer = manifestWriteTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const isTerminal = HARNESS_TERMINAL_RUN_STATUSES.has(String(patch.status || ""));

  if (isTerminal) {
    clearTimeout(manifestWriteTimers.get(key));
    manifestWriteTimers.delete(key);
    await writeJsonValidated(key, next);
    manifestCache.delete(key);
    manifestLastAccessed.delete(key);
  } else if (debounceMs > 0) {
    manifestWriteTimers.set(
      key,
      setTimeout(() => flushManifestDebounced(key), debounceMs),
    );
  } else {
    await writeJsonValidated(key, next);
    manifestCache.delete(key);
    manifestLastAccessed.delete(key);
  }
}

async function flushManifestDebounced(key) {
  manifestWriteTimers.delete(key);
  const cached = manifestCache.get(key);
  if (!cached) return;
  try {
    await writeJsonValidated(key, cached);
    manifestCache.delete(key);
    manifestLastAccessed.delete(key);
  } catch (err) {
    console.warn(`[harness] Manifest debounced write failed for ${key}: ${err.message}`);
  }
}

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
      console.error(`[harness] Failed to flush manifest ${key}:`, err.message);
    }
  }
}

const jsonlBuffers = new Map();
const jsonlFlushTimers = new Map();

const jsonlFlushFailures = new Map();
const jsonlFlushStrategies = new Map();
const tmpCleanupLastRunByFile = new Map();
const runWriteOperations = new Map();
const jsonlOperations = new Map();

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function unlinkIfPresent(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

function resolveRunWriteLockPath(targetPath = "") {
  const dir = path.dirname(text(targetPath));
  if (!dir || dir === ".") return "";
  return path.join(dir, HARNESS_FILES.RUN_WRITE_LOCK);
}

async function serializeOperation(operations, key, operation) {
  const previous = operations.get(key);
  const current = (async () => {
    if (previous) await previous.catch(() => undefined);
    return operation();
  })();
  operations.set(key, current);
  try {
    return await current;
  } finally {
    if (operations.get(key) === current) operations.delete(key);
  }
}

async function withRunWriteLock(targetPath, operation) {
  const lockPath = resolveRunWriteLockPath(targetPath);
  if (!lockPath) return operation();
  const runDir = path.dirname(lockPath);
  return serializeOperation(runWriteOperations, runDir, () => executeRunWrite(lockPath, operation));
}

async function executeRunWrite(lockPath, operation) {
  const runDir = path.dirname(lockPath);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(lockPath, String(Date.now()), "utf-8");
  try {
    return await operation();
  } finally {
    await runBestEffort(() => unlinkIfPresent(lockPath), {
      operationName: "harnessStore.removeRunWriteLock",
      context: { lockPath },
    });
  }
}

function normalizeFlushStrategy(input) {
  if (!isPlainObject(input)) {
    throw new TypeError("harness appendJsonlBuffered requires a jsonlFlushStrategy object");
  }
  return createHarnessJsonlFlushStrategySchema().parse(input);
}

function clearJsonlFlushTimer(filePath = "") {
  const timer = jsonlFlushTimers.get(filePath);
  if (timer) clearTimeout(timer);
  jsonlFlushTimers.delete(filePath);
}

function scheduleJsonlFlush(filePath, maxTime, strategy) {
  if (!filePath || jsonlFlushTimers.has(filePath) || maxTime <= 0) return;
  jsonlFlushTimers.set(
    filePath,
    setTimeout(async () => {
      jsonlFlushTimers.delete(filePath);
      await flushJsonlBuffer(filePath, strategy).catch((error) => {
        console.error(`[harness] Background JSONL flush failed for ${filePath}:`, error);
      });
    }, maxTime),
  );
}

function computeJsonlRetryDelayMs(retries = 1) {
  const cappedRetries = Math.max(1, Number(retries) || 1);
  const backoff = Math.min(
    TIME_THRESHOLDS.harness.jsonlRetryMaxDelayMs,
    TIME_THRESHOLDS.harness.jsonlRetryBaseDelayMs * 2 ** (cappedRetries - 1),
  );
  const jitterFactor = 0.5 + Math.random();
  return Math.max(50, Math.round(backoff * jitterFactor));
}

function scheduleJsonlRetry(filePath, strategy, retries) {
  if (!filePath) return;
  const delayMs = computeJsonlRetryDelayMs(retries);
  clearJsonlFlushTimer(filePath);
  jsonlFlushTimers.set(
    filePath,
    setTimeout(async () => {
      jsonlFlushTimers.delete(filePath);
      await flushJsonlBuffer(filePath, strategy).catch((error) => {
        console.error(`[harness] Background JSONL retry failed for ${filePath}:`, error);
      });
    }, delayMs),
  );
}

function estimateUtf8Bytes(inputText = "") {
  return Buffer.byteLength(String(inputText || ""), "utf8");
}

function calculateJsonlBufferBytes(buffer = []) {
  if (!Array.isArray(buffer) || !buffer.length) return 0;
  return buffer.reduce((sum, line) => sum + estimateUtf8Bytes(line), 0);
}

async function cleanupStaleTmpFilesForTarget(filePath = "", { force = false } = {}) {
  const targetPath = text(filePath);
  if (!targetPath) return 0;
  const now = Date.now();
  const last = Number(tmpCleanupLastRunByFile.get(targetPath) || 0);
  if (!force && now - last < TIME_THRESHOLDS.harness.tmpCleanupMinIntervalMs) return 0;
  tmpCleanupLastRunByFile.set(targetPath, now);
  const dir = path.dirname(targetPath);
  const prefix = `${path.basename(targetPath)}.tmp.`;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      console.warn(`[harness] Failed to inspect temporary files near ${targetPath}:`, error);
    }
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry?.isFile?.() || !String(entry.name || "").startsWith(prefix)) continue;
    const tmpPath = path.join(dir, entry.name);
    removed += await removeStaleTmpFile(tmpPath, now);
  }
  if (removed > 0) {
    console.warn(`[harness] Cleaned ${removed} stale tmp file(s) near ${targetPath}`);
  }
  return removed;
}

async function removeStaleTmpFile(tmpPath, now) {
  try {
    const stat = await fs.stat(tmpPath);
    if (now - stat.mtimeMs <= TIME_THRESHOLDS.harness.tmpFileMaxAgeMs) return 0;
    await fs.unlink(tmpPath);
    return 1;
  } catch (error) {
    if (!isMissingPathError(error)) {
      console.warn(`[harness] Failed to clean temporary file ${tmpPath}:`, error);
    }
  }
  return 0;
}

export async function appendJsonlBuffered(filePath, record, flushStrategy, flushHint = {}) {
  if (!filePath || !record) throw new TypeError("JSONL append requires a path and record");
  const strategy = normalizeFlushStrategy(flushStrategy);
  const line = JSON.stringify(record);
  if (typeof line !== "string" || estimateUtf8Bytes(line) > strategy.maxBufferBytes)
    throw new RangeError("JSONL record exceeds buffer capacity");
  return serializeOperation(jsonlOperations, filePath, () =>
    appendJsonlRecord(filePath, line, strategy, flushHint),
  );
}

async function appendJsonlRecord(filePath, line, strategy, flushHint) {
  jsonlFlushStrategies.set(filePath, strategy);
  let buffer = jsonlBuffers.get(filePath);
  if (
    buffer &&
    (buffer.length >= strategy.maxBufferEntries ||
      calculateJsonlBufferBytes(buffer) + estimateUtf8Bytes(line) > strategy.maxBufferBytes)
  ) {
    clearJsonlFlushTimer(filePath);
    await flushJsonlBufferLocked(filePath, strategy);
    buffer = jsonlBuffers.get(filePath);
  }
  if (!buffer) {
    buffer = [];
    jsonlBuffers.set(filePath, buffer);
  }

  buffer.push(line);
  jsonlFlushStrategies.set(filePath, strategy);

  const reason = text(flushHint?.reason).toLowerCase();
  const shouldFlushByReason =
    (reason === HARNESS_FLUSH_REASONS.TERMINAL && strategy.onTerminal) ||
    (reason === HARNESS_FLUSH_REASONS.ERROR && strategy.onError);

  if (buffer.length >= strategy.maxSize || shouldFlushByReason) {
    clearJsonlFlushTimer(filePath);
    await flushJsonlBufferLocked(filePath, strategy);
  } else {
    scheduleJsonlFlush(filePath, strategy.maxTime, strategy);
  }
}

async function flushJsonlBuffer(filePath, strategy) {
  return serializeOperation(jsonlOperations, filePath, () =>
    flushJsonlBufferLocked(filePath, strategy),
  );
}

async function flushJsonlBufferLocked(filePath, strategy) {
  const buffer = jsonlBuffers.get(filePath);
  if (!buffer || buffer.length === 0) return;

  const lines = buffer.join("\n") + "\n";
  try {
    await appendFileValidated(filePath, lines, strategy);
    jsonlFlushFailures.delete(filePath);
    jsonlBuffers.delete(filePath);
    jsonlFlushStrategies.delete(filePath);
  } catch (err) {
    console.error(`[harness] JSONL flush failed for ${filePath}:`, err.message);
    const retries = Number(jsonlFlushFailures.get(filePath) || 0) + 1;
    jsonlFlushFailures.set(filePath, retries);
    if (retries <= strategy.maxRetry) scheduleJsonlRetry(filePath, strategy, retries);
    else clearJsonlFlushTimer(filePath);
    throw err;
  }
}

export async function flushAllJsonlBuffers() {
  const filePaths = Array.from(jsonlBuffers.keys());
  for (const filePath of filePaths) {
    clearJsonlFlushTimer(filePath);
    await flushJsonlBuffer(filePath, requireJsonlFlushStrategy(filePath));
  }
}

function requireJsonlFlushStrategy(filePath) {
  const strategy = jsonlFlushStrategies.get(filePath);
  if (!strategy) throw new Error(`harness JSONL buffer has no flush strategy: ${filePath}`);
  return strategy;
}

export async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (isMissingPathError(error)) return fallback;
    throw error;
  }
}

export async function writeJson(filePath, data) {
  await writeJsonValidated(filePath, data);
}

async function writeJsonValidated(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp.${randomUUID()}`;

  await withRunWriteLock(filePath, async () => {
    await fs.mkdir(dir, { recursive: true });
    await cleanupStaleTmpFilesForTarget(filePath);

    try {
      await fs.writeFile(tmpPath, content, "utf-8");
      await verifyJsonWrite(tmpPath, content);
      await fs.rename(tmpPath, filePath);
    } finally {
      await unlinkIfPresent(tmpPath);
    }
  });
}

async function verifyJsonWrite(tmpPath, content) {
  if (process.env.HARNESS_VALIDATE_WRITES !== "1") return;
  const written = await fs.readFile(tmpPath, "utf-8");
  JSON.parse(written);
  if (written !== content) throw new Error(`JSON write verification mismatch: ${tmpPath}`);
}

function buildRotatedJsonlPath(filePath = "") {
  const parsed = path.parse(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = randomUUID();
  return path.join(parsed.dir, `${parsed.name}.${stamp}.${suffix}${parsed.ext || ".jsonl"}`);
}

function isRotatedJsonlForFile(entryName = "", filePath = "") {
  const parsed = path.parse(filePath);
  const ext = parsed.ext || ".jsonl";
  return (
    String(entryName || "").startsWith(`${parsed.name}.`) && String(entryName || "").endsWith(ext)
  );
}

async function pruneRotatedJsonlFiles(filePath = "", maxFiles = 0) {
  const keep = Number(maxFiles);
  if (!Number.isFinite(keep) || keep <= 0) return;
  const dir = path.dirname(filePath);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (!isMissingPathError(error)) {
      console.warn(`[harness] Failed to inspect rotated JSONL files near ${filePath}:`, error);
    }
    return;
  }
  const rotated = [];
  for (const entry of entries) {
    if (!entry?.isFile?.() || !isRotatedJsonlForFile(entry.name, filePath)) continue;
    const rotatedPath = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(rotatedPath);
      rotated.push({ path: rotatedPath, mtimeMs: Number(stat?.mtimeMs || 0) });
    } catch (error) {
      if (!isMissingPathError(error)) {
        console.warn(`[harness] Failed to inspect rotated JSONL file ${rotatedPath}:`, error);
      }
    }
  }
  if (rotated.length <= keep) return;
  rotated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of rotated.slice(keep)) {
    await runBestEffort(() => fs.unlink(item.path), {
      operationName: "harnessStore.removeRotatedJsonlFile",
      context: { filePath: item.path },
    });
  }
}

async function rotateJsonlIfNeeded(filePath, content, strategy) {
  const { maxFileBytes } = strategy;
  if (maxFileBytes <= 0) return;
  let currentSize = 0;
  try {
    const stat = await fs.stat(filePath);
    currentSize = Number(stat?.size || 0);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  if (currentSize <= 0 || currentSize + estimateUtf8Bytes(content) <= maxFileBytes) return;
  await fs.rename(filePath, buildRotatedJsonlPath(filePath));
  await pruneRotatedJsonlFiles(filePath, strategy.maxFiles);
}

async function appendFileValidated(filePath, content, strategy) {
  await withRunWriteLock(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await rotateJsonlIfNeeded(filePath, content, strategy);
    await fs.appendFile(filePath, content, "utf-8");
  });
}
