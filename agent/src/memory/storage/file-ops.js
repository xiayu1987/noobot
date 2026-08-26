/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { MEMORY_FILE_SPLIT_MAX_CHARS, getMemoryFileSplitMaxChars } from "../constants.js";
import {
  ATOMIC_RENAME_RETRY_DELAYS_MS,
  writeFileAtomic,
} from "../../shared/storage/atomic-file-write.js";
import {
  isMissingPersistencePathError,
  readPersistedJsonFile,
} from "../../shared/storage/json-file-reader.js";

export async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isMissingPersistencePathError(error)) return false;
    throw error;
  }
}

export async function readJson(filePath, fallback = {}) {
  return readPersistedJsonFile({ filePath, fallback, readFile });
}

export async function writeJson(filePath, payload = {}) {
  await writeFileAtomic({
    filePath,
    content: JSON.stringify(payload, null, 2),
    writeFile,
    rename,
    remove: rm,
    retryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
  });
}

export async function readText(filePath, fallback = "") {
  let baseText;
  try {
    baseText = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPersistencePathError(error)) return fallback;
    throw error;
  }
  const partEntries = await listSplitPartEntries(filePath);
  if (!partEntries.length) return baseText;
  const chunks = [baseText];
  for (const item of partEntries) chunks.push(await readFile(item.path, "utf8"));
  return chunks.join("");
}

export async function appendText(filePath, content = "") {
  const existing = await readText(filePath, "");
  await writeText(filePath, `${existing}${String(content || "")}`);
}

export async function writeText(filePath, content = "") {
  const text = String(content || "");
  const chunks = splitTextIntoChunks(text, getMemoryFileSplitMaxChars());
  const [firstChunk, ...restChunks] = chunks.length ? chunks : [""];
  await writeFile(filePath, firstChunk, "utf8");

  const stalePartEntries = await listSplitPartEntries(filePath);
  const keepPartPaths = new Set();
  for (let i = 0; i < restChunks.length; i += 1) {
    const partPath = resolveSplitPartPath(filePath, i + 1);
    keepPartPaths.add(partPath);
    await writeFile(partPath, restChunks[i], "utf8");
  }
  for (const entry of stalePartEntries) {
    if (keepPartPaths.has(entry.path)) continue;
    await rm(entry.path, { force: true });
  }
}

function resolveSplitPartPath(filePath = "", index = 0) {
  return `${String(filePath || "")}.part${Number(index)}`;
}

async function listSplitPartEntries(filePath = "") {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const entries = await safeReadDirEntries(dir);
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const matched = new RegExp(`^${escapeRegExp(base)}\\.part(\\d+)$`).exec(
      String(entry.name || ""),
    );
    if (!matched) continue;
    const index = Number(matched[1]);
    if (!Number.isFinite(index) || index <= 0) continue;
    out.push({ index, path: path.join(dir, entry.name) });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

function escapeRegExp(text = "") {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitTextIntoChunks(text = "", maxChars = MEMORY_FILE_SPLIT_MAX_CHARS) {
  const normalizedText = String(text || "");
  const safeMaxChars = Number(maxChars);
  if (!Number.isFinite(safeMaxChars) || safeMaxChars <= 0) return [normalizedText];
  if (normalizedText.length <= safeMaxChars) return [normalizedText];
  const chunks = [];
  for (let index = 0; index < normalizedText.length; index += safeMaxChars) {
    chunks.push(normalizedText.slice(index, index + safeMaxChars));
  }
  return chunks;
}

export async function ensureDir(dirPath = "") {
  await mkdir(dirPath, { recursive: true });
}

export async function safeReadDirEntries(dirPath = "") {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPersistencePathError(error)) return [];
    throw error;
  }
}

export async function removeDir(dirPath = "") {
  await rm(dirPath, { recursive: true, force: true });
}
