/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { isMissingPersistencePathError } from "../shared/storage/json-file-reader.js";
import { text } from "@noobot/shared/value";
import { parseWorkspaceSessionTombstones } from "@noobot/workspace-protocol/session-store";
import { quarantineMigrationUnit } from "./migration-quarantine.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";

const { RETIRED_SESSION_LIFECYCLE_RECORDS_DIR } = WORKSPACE_LAYOUT;
const QUARANTINE_KIND = WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LIFECYCLE;

function upgradeError(message, details) {
  const error = new Error(message);
  error.code = "WORKSPACE_SESSION_LIFECYCLE_UPGRADE_INVALID";
  error.details = details;
  return error;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
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

async function backupRecord(backupBase, relativePath, record) {
  const backupPath = path.join(backupBase, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(record, null, 2)}\n`);
  return backupPath;
}

async function readTextOrNull(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPersistencePathError(error)) return null;
    throw error;
  }
}

async function planRecord({ base, relativePath, tombstoneSessions }) {
  const record = await readJson(path.join(base, relativePath));
  const sessionId = text(record.sessionId);
  if (!sessionId) {
    throw upgradeError(`lifecycle record has no sessionId: ${relativePath}`, {
      path: relativePath,
    });
  }
  const deletedAtMs =
    record.state === "deleted" && !Object.hasOwn(tombstoneSessions, sessionId)
      ? resolveDeletedAtMs(record, relativePath)
      : null;
  return { relativePath, record, sessionId, deletedAtMs };
}

async function retireRecord({ base, backupBase, plan }) {
  const { relativePath, record } = plan;
  const backupPath = await backupRecord(backupBase, relativePath, record);
  await rm(path.join(base, relativePath));
  return { path: relativePath, backupPath };
}

async function planRecords({ base, tombstoneSessions }) {
  const recordsDir = path.join(base, RETIRED_SESSION_LIFECYCLE_RECORDS_DIR);
  const plans = [];
  const quarantined = [];
  for (const name of await listRecordFiles(recordsDir)) {
    const relativePath = path.join(RETIRED_SESSION_LIFECYCLE_RECORDS_DIR, name);
    try {
      const plan = await planRecord({ base, relativePath, tombstoneSessions });
      if (plan) plans.push(plan);
    } catch (error) {
      if (error?.code !== "WORKSPACE_SESSION_LIFECYCLE_UPGRADE_INVALID") throw error;
      quarantined.push(
        await quarantineMigrationUnit({
          base,
          kind: QUARANTINE_KIND,
          relativePath,
          error,
          move: true,
        }),
      );
    }
  }
  return { plans, quarantined };
}

export async function upgradeSessionLifecycle({
  base,
  backupBase,
  onSessionProcessed = ignoreSessionProgress,
}) {
  const upgradedAt = new Date().toISOString();
  const tombstoneFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE);
  const tombstoneSessions = parseWorkspaceSessionTombstones({
    raw: await readTextOrNull(tombstoneFile),
    file: tombstoneFile,
  });
  const { plans, quarantined } = await planRecords({ base, tombstoneSessions });
  const deleted = plans.filter((plan) => plan.deletedAtMs !== null);
  for (const plan of deleted) tombstoneSessions[plan.sessionId] = plan.deletedAtMs;
  if (deleted.length) {
    await mkdir(path.dirname(tombstoneFile), { recursive: true });
    await writeJson(tombstoneFile, { sessions: tombstoneSessions, updatedAt: upgradedAt });
  }
  const retired = [];
  for (const plan of plans) {
    retired.push(await retireRecord({ base, backupBase, plan }));
    onSessionProcessed();
  }
  await rm(path.join(base, RETIRED_SESSION_LIFECYCLE_RECORDS_DIR), {
    recursive: true,
    force: true,
  });
  return {
    retired,
    quarantined,
    tombstoneSessionsAdded: deleted.length > 0,
  };
}
