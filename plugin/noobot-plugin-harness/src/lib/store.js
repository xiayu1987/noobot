/*
 * Noobot Harness - Storage utilities
 *
 * Optimizations:
 *  - Manifest: memory cache + debounced write
 *  - JSONL: buffered writes (batch size or interval)
 *  - Write validation: JSON integrity check
 */
import fs from "node:fs/promises";
import path from "node:path";

// ---- Manifest Cache & Debounce ----
const manifestCache = new Map();
const manifestWriteTimers = new Map();

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
  } else if (debounceMs > 0) {
    manifestWriteTimers.set(
      key,
      setTimeout(async () => {
        const cached = manifestCache.get(key);
        if (cached) {
          await writeJsonValidated(key, cached);
          manifestCache.delete(key);
        }
        manifestWriteTimers.delete(key);
      }, debounceMs),
    );
  } else {
    await writeJsonValidated(key, next);
    manifestCache.delete(key);
  }
}

/**
 * Flush all pending manifest writes immediately.
 */
export async function flushAllManifests() {
  const entries = Array.from(manifestCache.entries());
  manifestCache.clear();
  for (const [key, value] of entries) {
    const timer = manifestWriteTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      manifestWriteTimers.delete(key);
    }
    try {
      await writeJsonValidated(key, value);
    } catch {}
  }
}

// ---- JSONL Buffer ----
const jsonlBuffers = new Map(); // filePath -> string[]
const jsonlFlushTimers = new Map(); // filePath -> Timer

const DEFAULT_JSONL_BATCH_SIZE = 50;
const DEFAULT_JSONL_FLUSH_INTERVAL_MS = 2000;

/**
 * Append to JSONL buffer. Flushes when batch size reached or on interval.
 */
export async function appendJsonlBuffered(
  filePath,
  record,
  batchSize = DEFAULT_JSONL_BATCH_SIZE,
  flushIntervalMs = DEFAULT_JSONL_FLUSH_INTERVAL_MS,
) {
  if (!filePath || !record) return;

  let buffer = jsonlBuffers.get(filePath);
  if (!buffer) {
    buffer = [];
    jsonlBuffers.set(filePath, buffer);
  }

  buffer.push(JSON.stringify(record));

  if (buffer.length >= batchSize) {
    await flushJsonlBuffer(filePath);
  } else if (!jsonlFlushTimers.has(filePath) && flushIntervalMs > 0) {
    jsonlFlushTimers.set(
      filePath,
      setTimeout(async () => {
        await flushJsonlBuffer(filePath);
        jsonlFlushTimers.delete(filePath);
      }, flushIntervalMs),
    );
  }
}

/**
 * Flush a single JSONL buffer to disk.
 */
async function flushJsonlBuffer(filePath) {
  const buffer = jsonlBuffers.get(filePath);
  if (!buffer || buffer.length === 0) return;

  const lines = buffer.join("\n") + "\n";
  jsonlBuffers.set(filePath, []); // Clear buffer before write (avoid race)

  try {
    await appendFileValidated(filePath, lines);
  } catch {
    // On failure, prepend back to buffer for retry
    const current = jsonlBuffers.get(filePath) || [];
    jsonlBuffers.set(filePath, [...buffer, ...current]);
  }
}

/**
 * Flush all JSONL buffers immediately.
 */
export async function flushAllJsonlBuffers() {
  const filePaths = Array.from(jsonlBuffers.keys());
  for (const filePath of filePaths) {
    const timer = jsonlFlushTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      jsonlFlushTimers.delete(filePath);
    }
    await flushJsonlBuffer(filePath);
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

async function writeJsonValidated(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
  // Validate by reading back
  try {
    const written = await fs.readFile(filePath, "utf-8");
    JSON.parse(written); // Throws if invalid
  } catch {
    // Fallback: try writing again
    await fs.writeFile(filePath, content, "utf-8");
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
