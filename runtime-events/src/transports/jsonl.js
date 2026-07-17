/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from 'node:fs/promises';
import path from 'node:path';

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
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return path.join(parsed.dir, `${parsed.name}.${stamp}${parsed.ext}`);
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
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
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.size + Buffer.byteLength(line, 'utf8') <= maxFileBytes) return null;
  const archive = await nextArchiveFile(file);
  await fs.rename(file, archive);
  return archive;
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
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const archives = [];
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(path.dirname(file), entry);
    if (!isArchiveForActiveFile(file, fullPath)) return;
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) return;
    archives.push({ file: fullPath, mtimeMs: stat.mtimeMs });
  }));
  return archives.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
}

async function cleanupArchives(file, options = {}) {
  const retentionDays = resolveNonNegativeInteger(options.retentionDays);
  const maxArchives = resolveNonNegativeInteger(options.maxArchives);
  if (!retentionDays && !maxArchives) return { deletedFiles: [] };
  const archives = await listArchiveFiles(file);
  const deleteSet = new Set();
  if (retentionDays) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const archive of archives) {
      if (archive.mtimeMs < cutoff) deleteSet.add(archive.file);
    }
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
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { deletedFiles };
}

export async function appendJsonLine(file, record, options = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  const rotatedFile = await rotateIfNeeded(file, line, options);
  await fs.appendFile(file, line, 'utf8');
  let cleanup = { deletedFiles: [] };
  try {
    cleanup = await cleanupArchives(file, options);
  } catch {
    cleanup = { deletedFiles: [], error: true };
  }
  return { ok: true, file, rotatedFile, deletedFiles: cleanup.deletedFiles, cleanupError: Boolean(cleanup.error) };
}
