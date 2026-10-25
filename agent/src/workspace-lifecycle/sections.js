/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { CONFIG_DOCUMENT_SCOPE, repairConfigDocument } from "@noobot/agent-config-protocol";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_UNMARKED_VERSION,
  WORKSPACE_LAYOUT_UPGRADE_OWNER,
  WORKSPACE_LAYOUT_VERSION,
  WORKSPACE_RUNTIME_DIRECTORIES,
  WORKSPACE_SECTION,
  WORKSPACE_SECTIONS,
  createEmptySessionTree,
  parseWorkspaceLayoutState,
  planWorkspaceLayoutMigrations,
  planWorkspaceLayoutUpgrades,
  renderWorkspaceLayoutState,
} from "@noobot/workspace-protocol";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { repairWorkspaceMemoryDocuments } from "../memory/storage/repair.js";
import { upgradeSessionStorage } from "./session-storage-upgrade.js";
import { upgradeSessionLifecycle } from "./session-lifecycle-upgrade.js";
import { upgradeSessionTransferEnvelopes } from "./session-transfer-envelope-upgrade.js";
import { upgradeModelContextSnapshots } from "./model-context-snapshot-upgrade.js";
import { upgradeSessionMessageIdentity } from "./session-message-identity-upgrade.js";
import { releaseQuarantinedUnits } from "./migration-quarantine.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";

const LAYOUT_UPGRADE_HANDLERS = Object.freeze({
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_STORAGE]: upgradeSessionStorage,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LIFECYCLE]: upgradeSessionLifecycle,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TRANSFER_ENVELOPE]: upgradeSessionTransferEnvelopes,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT]: upgradeModelContextSnapshots,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY]: upgradeSessionMessageIdentity,
});

const QUARANTINE_RETRY_OWNERS = Object.freeze([
  WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LIFECYCLE,
  WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TRANSFER_ENVELOPE,
  WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
  WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
]);

const retriedQuarantines = new Set();

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function migrateWorkspaceLayout({ base, backup }) {
  const actions = planWorkspaceLayoutMigrations({
    exists: (relativePath) => existsSync(path.join(base, relativePath)),
  });
  const migrated = [];
  for (const item of actions) {
    const backupPath = await backup(item.from);
    const target = path.join(base, item.to);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(base, item.from), target);
    migrated.push({ ...item, backupPath });
  }
  return migrated;
}

async function readInstalledLayoutVersion(base, created) {
  try {
    const text = await readFile(path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE), "utf8");
    return parseWorkspaceLayoutState(text).version;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return created ? WORKSPACE_LAYOUT_VERSION : WORKSPACE_LAYOUT_UNMARKED_VERSION;
  }
}

async function writeLayoutVersion(base, version) {
  const statePath = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeConfigDocumentText(statePath, renderWorkspaceLayoutState({ version }));
}

function createUpgradeProgress(reportProgress, { upgradeId, upgradeIndex, upgradeCount }) {
  let processedSessions = 0;
  const report = () => reportProgress({ upgradeId, upgradeIndex, upgradeCount, processedSessions });
  report();
  return () => {
    processedSessions += 1;
    report();
  };
}

export async function upgradeWorkspaceLayout({
  base,
  backupBase,
  created,
  scopedSessionRoots,
  reportProgress = ignoreSessionProgress,
}) {
  const installedVersion = await readInstalledLayoutVersion(base, created);
  const applied = [];
  const upgrades = planWorkspaceLayoutUpgrades({ installedVersion });
  for (const [index, upgrade] of upgrades.entries()) {
    try {
      const result = await LAYOUT_UPGRADE_HANDLERS[upgrade.owner]({
        base,
        backupBase,
        scopedSessionRoots,
        onSessionProcessed: createUpgradeProgress(reportProgress, {
          upgradeId: upgrade.id,
          upgradeIndex: index + 1,
          upgradeCount: upgrades.length,
        }),
      });
      await writeLayoutVersion(base, upgrade.toVersion);
      applied.push({ id: upgrade.id, toVersion: upgrade.toVersion, result });
    } catch (error) {
      applied.push({
        id: upgrade.id,
        toVersion: upgrade.toVersion,
        failed: { code: String(error?.code || ""), message: String(error?.message || error) },
      });
      return applied;
    }
  }
  const statePath = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  if (created || !(await pathExists(statePath))) {
    await writeLayoutVersion(base, WORKSPACE_LAYOUT_VERSION);
  }
  applied.push(
    ...(await retryQuarantinedUnits({ base, backupBase, scopedSessionRoots, reportProgress })),
  );
  return applied;
}

async function retryQuarantinedUnits({ base, backupBase, scopedSessionRoots, reportProgress }) {
  const retried = [];
  for (const owner of QUARANTINE_RETRY_OWNERS) {
    const key = `${base}\u0000${owner}`;
    if (retriedQuarantines.has(key)) continue;
    retriedQuarantines.add(key);
    const id = `quarantine-retry:${owner}`;
    try {
      const released = await releaseQuarantinedUnits({ base, kind: owner });
      if (!released.length) continue;
      const result = await LAYOUT_UPGRADE_HANDLERS[owner]({
        base,
        backupBase,
        scopedSessionRoots,
        onSessionProcessed: createUpgradeProgress(reportProgress, {
          upgradeId: id,
          upgradeIndex: 1,
          upgradeCount: 1,
        }),
      });
      retried.push({ id, released, result });
    } catch (error) {
      retried.push({
        id,
        failed: { code: String(error?.code || ""), message: String(error?.message || error) },
      });
    }
  }
  return retried;
}

export async function ensureRuntimeDirectories(base) {
  for (const relativePath of WORKSPACE_RUNTIME_DIRECTORIES) {
    await mkdir(path.join(base, relativePath), { recursive: true });
  }
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  if (await pathExists(treeFile)) return;
  await writeFileAtomic({
    filePath: treeFile,
    content: `${JSON.stringify(createEmptySessionTree(), null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
}

export function repairMemorySection(base) {
  return repairWorkspaceMemoryDocuments({ base });
}

function writeConfigDocumentText(filePath, content) {
  return writeFileAtomic({
    filePath,
    content,
    writeFile,
    rename,
    remove: rm,
  });
}

function writeConfigDocument(filePath, document) {
  return writeConfigDocumentText(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

async function readConfigTarget(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, document: {} };
    throw error;
  }
  try {
    return { exists: true, raw, document: JSON.parse(raw) };
  } catch {
    return { exists: true, raw, document: null };
  }
}

async function retireConfigPaths({ base, backup }) {
  const retired = [];
  for (const relativePath of WORKSPACE_SECTIONS[WORKSPACE_SECTION.CONFIG].retiredPaths) {
    const backupPath = await backup(relativePath);
    if (backupPath === null) continue;
    await rm(path.join(base, relativePath), { recursive: true, force: true });
    retired.push({ path: relativePath, backupPath });
  }
  return retired;
}

export async function repairConfigSection({ base, baseValues, backup, onlyInvalid = false }) {
  const retired = await retireConfigPaths({ base, backup });
  const filePath = path.join(base, WORKSPACE_LAYOUT.CONFIG_FILE);
  const current = await readConfigTarget(filePath);
  if (onlyInvalid && current.exists && current.document !== null) return { retired, repair: null };
  if (current.exists && current.document === null) await backup(WORKSPACE_LAYOUT.CONFIG_FILE);
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    baseValues,
    target: current.document ?? {},
  });
  const next = `${JSON.stringify(repaired.document, null, 2)}\n`;
  if (current.raw !== next) await writeConfigDocument(filePath, repaired.document);
  return { retired, repair: repaired.report };
}

export function resolveWorkspaceBackupBase(base, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, stamp);
}

export function createSectionBackup(backupBase, base) {
  return async function backup(relativePath) {
    const source = path.join(base, relativePath);
    if (!(await pathExists(source))) return null;
    const target = path.join(backupBase, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    return target;
  };
}

async function clearRuntimeSection(base) {
  const preserved = new Set(WORKSPACE_SECTIONS[WORKSPACE_SECTION.RUNTIME].preserveOnReset);
  const runtimeRoot = path.join(base, WORKSPACE_LAYOUT.RUNTIME_DIR);
  if (!(await pathExists(runtimeRoot))) return;
  for (const name of await readdir(runtimeRoot)) {
    const relativePath = `${WORKSPACE_LAYOUT.RUNTIME_DIR}/${name}`;
    if (preserved.has(relativePath)) continue;
    await rm(path.join(base, relativePath), { recursive: true, force: true });
  }
}

export async function clearSection({ base, section, backup }) {
  const definition = WORKSPACE_SECTIONS[section];
  if (section === WORKSPACE_SECTION.RUNTIME) return clearRuntimeSection(base);
  for (const relativePath of definition.paths) {
    if (definition.backupOnReset) await backup(relativePath);
    await rm(path.join(base, relativePath), { recursive: true, force: true });
  }
  return undefined;
}
