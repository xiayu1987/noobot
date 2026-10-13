/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";

const V4_RECORD_FIELDS = Object.freeze(["schemaVersion", "sessionId", "repair", "updatedAt"]);

function isV4Record(record) {
  return (
    record?.repair?.status === "failed" &&
    Object.keys(record).every((field) => V4_RECORD_FIELDS.includes(field))
  );
}

function upgradeError(message, details) {
  const error = new Error(message);
  error.code = "WORKSPACE_SESSION_LIFECYCLE_UPGRADE_INVALID";
  error.details = details;
  return error;
}

async function readJson(filePath, { optional }) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw upgradeError(`invalid JSON document: ${filePath}`, { filePath });
  }
}

async function listRecordFiles(recordsDir) {
  try {
    return (await readdir(recordsDir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function writeJson(filePath, value) {
  return writeFileAtomic({
    filePath,
    content: `${JSON.stringify(value, null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
}

function resolveDeletedAtMs(record, relativePath) {
  const deletedAtMs = Date.parse(String(record.deletedAt ?? ""));
  if (!Number.isFinite(deletedAtMs)) {
    throw upgradeError(`deleted lifecycle record has no valid deletedAt: ${relativePath}`, {
      path: relativePath,
    });
  }
  return deletedAtMs;
}

async function readTombstoneSessions(tombstoneFile) {
  const tombstone = await readJson(tombstoneFile, { optional: true });
  if (tombstone === null) return {};
  const sessions = tombstone?.sessions;
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
    throw upgradeError(`invalid session tombstone: ${tombstoneFile}`, { filePath: tombstoneFile });
  }
  return { ...sessions };
}

async function backupRecord(backupBase, relativePath, record) {
  const backupPath = path.join(backupBase, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(record, null, 2)}\n`);
  return backupPath;
}

export async function upgradeSessionLifecycle({ base, backupBase }) {
  const upgradedAt = new Date().toISOString();
  const recordsDir = path.join(base, WORKSPACE_LAYOUT.SESSION_LIFECYCLE_RECORDS_DIR);
  const tombstoneFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  const tombstoneSessions = await readTombstoneSessions(tombstoneFile);
  const rewritten = [];
  const retired = [];
  let tombstoneChanged = false;

  for (const name of await listRecordFiles(recordsDir)) {
    const relativePath = path.join(WORKSPACE_LAYOUT.SESSION_LIFECYCLE_RECORDS_DIR, name);
    const record = await readJson(path.join(base, relativePath), { optional: false });
    if (isV4Record(record)) continue;
    const sessionId = String(record.sessionId ?? "").trim();
    if (!sessionId) {
      throw upgradeError(`lifecycle record has no sessionId: ${relativePath}`, {
        path: relativePath,
      });
    }
    if (record.state === "deleted" && !Object.hasOwn(tombstoneSessions, sessionId)) {
      tombstoneSessions[sessionId] = resolveDeletedAtMs(record, relativePath);
      tombstoneChanged = true;
    }
    const backupPath = await backupRecord(backupBase, relativePath, record);
    if (record.repair?.status === "failed") {
      await writeJson(path.join(base, relativePath), {
        schemaVersion: 1,
        sessionId,
        repair: record.repair,
        updatedAt: upgradedAt,
      });
      rewritten.push({ path: relativePath, backupPath });
    } else {
      await rm(path.join(base, relativePath));
      retired.push({ path: relativePath, backupPath });
    }
  }

  if (tombstoneChanged) {
    await mkdir(path.dirname(tombstoneFile), { recursive: true });
    await writeJson(tombstoneFile, {
      sessions: tombstoneSessions,
      updatedAt: upgradedAt,
    });
  }
  return { rewritten, retired, tombstoneSessionsAdded: tombstoneChanged };
}
