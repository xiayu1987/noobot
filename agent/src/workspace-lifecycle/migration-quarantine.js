/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  assertWorkspaceMigrationQuarantineRecord,
  classifyHistoricalMigrationQuarantine,
} from "@noobot/workspace-protocol/migration-quarantine";
import { fsLstat, fsRename, fsRm } from "../shared/storage/fs-adapter.js";
import {
  durableJsonPublicationTarget,
  ensureDurableStorageDirectory,
  syncStorageDirectory,
  writeDurableJsonFile,
} from "../shared/storage/durable-file.js";

const REASON_SUFFIX = ".reason.json";

function describeError(error) {
  return {
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
    ...(error?.details ? { details: error.details } : {}),
  };
}

export async function quarantineMigrationUnit({
  base,
  kind,
  relativePath,
  error,
  move = false,
  sessionStorage,
}) {
  const quarantineRoot = quarantineOwnerRoot(base, kind);
  const normalizedPath = readQuarantinePath(relativePath);
  const original = path.join(base, normalizedPath);
  const moveIdentity = move ? await readQuarantineIdentity(original) : undefined;
  if (moveIdentity === null) throw quarantineMissing(original);
  const quarantineId =
    sessionStorage === undefined
      ? undefined
      : createHash("sha256").update(`${normalizedPath}\0${moveIdentity}`).digest("hex");
  const target = path.join(quarantineRoot, quarantineId ?? normalizedPath);
  await ensureDurableStorageDirectory(path.dirname(target));
  const reasonPath = `${target}${REASON_SUFFIX}`;
  if (move && (await readQuarantineIdentity(target)) !== null) throw quarantineConflict(target);
  const reason = assertWorkspaceMigrationQuarantineRecord({
    kind,
    path: normalizedPath,
    moved: move,
    quarantinedAt: new Date().toISOString(),
    error: describeError(error),
    ...(moveIdentity === undefined ? {} : { moveIdentity }),
    ...(sessionStorage === undefined ? {} : { sessionStorage }),
    ...(quarantineId === undefined ? {} : { quarantineId }),
  });
  await writeDurableJsonFile(reasonPath, `${JSON.stringify(reason, null, 2)}\n`);
  if (move) await moveQuarantineEntry(original, target);
  return {
    path: normalizedPath,
    quarantinePath: path.relative(base, move ? target : reasonPath),
    error: reason.error,
    ...(sessionStorage === undefined ? {} : { sessionStorage }),
  };
}

async function readEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function quarantineOwnerRoot(base, kind) {
  if (readQuarantinePath(kind) !== path.basename(kind)) throw quarantineConflict(kind);
  return path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR, kind);
}

async function readQuarantineRecords({ base, kind, staged }) {
  const root = quarantineOwnerRoot(base, kind);
  const directories = [root];
  const records = [];
  for (const directory of directories) {
    const entries = await readEntries(directory);
    const { receipts, held } = await readDirectoryReceipts({ root, kind, directory, entries });
    records.push(...receipts);
    const receiptFiles = new Set(receipts.map(({ file }) => file));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (held.has(file) || receiptFiles.has(file)) continue;
      const target = durableJsonPublicationTarget(entry.name);
      if (entry.isFile() && target?.endsWith(REASON_SUFFIX)) staged?.push(file);
      else if (entry.isDirectory()) directories.push(file);
      else throw quarantineBlocked(base, [file]);
    }
  }
  return records.sort((left, right) => left.file.localeCompare(right.file));
}

async function readDirectoryReceipts({ root, kind, directory, entries }) {
  const receipts = [];
  const heldPaths = new Set();
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(REASON_SUFFIX))
    .sort((left, right) => right.name.length - left.name.length);
  for (const entry of candidates) {
    const file = path.join(directory, entry.name);
    if (heldPaths.has(file)) continue;
    const held = file.slice(0, -REASON_SUFFIX.length);
    const reason = await readQuarantineReason(file);
    const relativePath = readQuarantinePath(reason.path);
    if (reason.kind !== kind || path.join(root, reason.quarantineId ?? relativePath) !== held)
      throw quarantineConflict(file);
    receipts.push({ file, held, relativePath, reason });
    if (reason.moved && !reason.restored) heldPaths.add(held);
  }
  return { receipts, held: heldPaths };
}

async function readQuarantineReason(file) {
  try {
    return assertWorkspaceMigrationQuarantineRecord(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw Object.assign(quarantineConflict(file), { cause: error });
    throw error;
  }
}

function readQuarantinePath(relativePath) {
  const parts = typeof relativePath === "string" ? relativePath.split(/[\\/]/) : [];
  if (
    !parts.length ||
    parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))
  ) {
    throw new TypeError("invalid workspace migration quarantine path");
  }
  return path.join(...parts);
}

async function readQuarantineIdentity(file) {
  try {
    const { dev, ino } = await fsLstat(file, { bigint: true });
    return `${dev}:${ino}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function quarantineConflict(destination) {
  return Object.assign(new Error(`Quarantine move cannot establish ownership of: ${destination}`), {
    code: "WORKSPACE_MIGRATION_QUARANTINE_CONFLICT",
    details: { destination },
  });
}

function quarantineMissing(file) {
  return Object.assign(new Error(`Missing quarantine source: ${file}`), { code: "ENOENT" });
}

async function syncMoveDirectories(from, to) {
  const directories = new Set([path.dirname(from), path.dirname(to)]);
  for (const directory of directories) await syncStorageDirectory(directory);
}

async function moveQuarantineEntry(from, to) {
  await fsRename(from, to);
  await syncMoveDirectories(from, to);
}

async function restoreQuarantinedEntry(reasonPath, reason, original) {
  const held = reasonPath.slice(0, -REASON_SUFFIX.length);
  const originalIdentity = await readQuarantineIdentity(original);
  const heldIdentity = await readQuarantineIdentity(held);
  if (heldIdentity === null) {
    if (originalIdentity === null) throw quarantineMissing(held);
    if (originalIdentity !== reason.moveIdentity) throw quarantineConflict(original);
    await syncMoveDirectories(held, original);
    return;
  }
  if (originalIdentity !== null) throw quarantineConflict(original);
  if (reason.moveIdentity !== heldIdentity) throw quarantineConflict(held);
  await ensureDurableStorageDirectory(path.dirname(original));
  await moveQuarantineEntry(held, original);
}

export async function restoreQuarantinedUnits({ base, kind, released }) {
  for (const { file, relativePath, reason } of await readQuarantineRecords({ base, kind })) {
    if (reason.moved && reason.restored !== true) {
      await restoreQuarantinedEntry(file, reason, path.join(base, relativePath));
    }
    if (reason.restored !== true)
      await writeDurableJsonFile(file, JSON.stringify({ ...reason, restored: true }));
    released.push(relativePath);
  }
}

export async function completeQuarantineRestores({ base, kind }) {
  const staged = [];
  for (const { file, reason } of await readQuarantineRecords({ base, kind, staged })) {
    if (reason.restored !== true) continue;
    await fsRm(file);
    await syncStorageDirectory(path.dirname(file));
  }
  for (const file of staged) {
    await fsRm(file);
    await syncStorageDirectory(path.dirname(file));
  }
}

export async function listQuarantinedUnits({ base }) {
  const quarantineRoot = path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR);
  const units = [];
  const owners = (await readEntries(quarantineRoot)).sort((a, b) => a.name.localeCompare(b.name));
  for (const owner of owners) {
    if (!owner.isDirectory())
      throw quarantineBlocked(base, [path.join(quarantineRoot, owner.name)]);
    for (const { file, held, relativePath, reason } of await readQuarantineRecords({
      base,
      kind: owner.name,
    })) {
      units.push({
        ...reason,
        path: relativePath,
        quarantinePath: path.relative(base, reason.moved && !reason.restored ? held : file),
      });
    }
  }
  return units;
}

function quarantineBlocked(base, files) {
  return Object.assign(
    new Error("Resolve workspace migration quarantines before using partition storage"),
    {
      code: "SESSION_STORAGE_UPGRADE_BLOCKED",
      details: { quarantinePaths: files.map((file) => path.relative(base, file)) },
    },
  );
}

export async function assertWorkspaceQuarantineEmpty(base) {
  for (const { quarantinePath, ...stored } of await listQuarantinedUnits({ base })) {
    const record = classifyHistoricalMigrationQuarantine(stored);
    if (record.sessionStorage === undefined)
      throw quarantineBlocked(base, [path.join(base, quarantinePath)]);
    if (record !== stored) {
      const reasonPath =
        path.join(base, quarantinePath) + (stored.moved && !stored.restored ? REASON_SUFFIX : "");
      await writeDurableJsonFile(reasonPath, `${JSON.stringify(record, null, 2)}\n`);
    }
    if (record.moved && !record.restored)
      await completeSessionStorageQuarantine(base, { ...record, quarantinePath });
  }
}

export async function listWorkspaceBackups({ base }) {
  return readWorkspaceBackups(base);
}

async function completeSessionStorageQuarantine(base, record) {
  const original = path.join(base, record.path);
  const held = path.join(base, record.quarantinePath);
  const heldIdentity = await readQuarantineIdentity(held);
  if (heldIdentity === record.moveIdentity) {
    await syncStorageDirectory(path.dirname(held));
  } else if (
    heldIdentity === null &&
    (await readQuarantineIdentity(original)) === record.moveIdentity
  ) {
    await moveQuarantineEntry(original, held);
  } else throw quarantineConflict(held);
}

async function readWorkspaceBackups(base) {
  try {
    const entries = await readdir(path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
