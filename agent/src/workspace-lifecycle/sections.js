/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  CONFIG_DOCUMENT_SCOPE,
  isPlainObject,
  repairConfigDocument,
  upgradeConfigModelLibrary,
} from "@noobot/agent-config-protocol";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_UNMARKED_VERSION,
  WORKSPACE_LAYOUT_UPGRADE_OWNER,
  WORKSPACE_LAYOUT_VERSION,
  WORKSPACE_RUNTIME_DIRECTORIES,
  WORKSPACE_SECTION,
  WORKSPACE_SECTIONS,
  assertWorkspaceLayoutReady,
  createWorkspaceMaintenanceError,
  parseWorkspaceLayoutState,
  planWorkspaceLayoutMigrations,
  planWorkspaceLayoutUpgrades,
  renderWorkspaceLayoutState,
} from "@noobot/workspace-protocol";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { repairWorkspaceMemoryDocuments } from "../memory/storage/repair.js";
import { ensureSessionTree, rebuildStoredSessionTree } from "./session-storage-upgrade.js";
import { assertWorkspaceQuarantineEmpty } from "./migration-quarantine.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { retireWorkspaceDirectoryLocks } from "./directory-lock-retirement.js";
import { retireUnsupportedSessionStorage } from "./session-storage-retirement.js";
import { upgradeAttachmentCatalogs } from "./attachment-catalog-upgrade.js";
import { upgradeWorkspacePartitionFormat } from "./upgrade-workspace-partition-format.js";
import { withExclusiveWorkspaceStorage } from "./workspace-storage-lock.js";
import { writeDurableJsonFile } from "../shared/storage/durable-file.js";

const LAYOUT_UPGRADE_HANDLERS = Object.freeze({
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.DIRECTORY_LOCK_RETIREMENT]: retireWorkspaceDirectoryLocks,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_STORAGE_RETIREMENT]: retireUnsupportedSessionStorage,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.ATTACHMENT_CATALOG]: upgradeAttachmentCatalogs,
  [WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_PARTITION_FORMAT]: upgradeWorkspacePartitionFormat,
});

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function migrateWorkspaceLayout({ base, backup }) {
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

export async function assertWorkspaceStorageReady(base, userId) {
  try {
    const version = await readInstalledLayoutVersion(base, false);
    if (version === WORKSPACE_LAYOUT_VERSION) return await assertWorkspaceQuarantineEmpty(base);
    if (!(await pathExists(base))) return;
  } catch (cause) {
    throw Object.assign(createWorkspaceMaintenanceError(userId), { cause });
  }
  throw createWorkspaceMaintenanceError(userId);
}

async function writeLayoutVersion(base, version) {
  const statePath = path.join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeDurableJsonFile(statePath, renderWorkspaceLayoutState({ version }));
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

async function prepareLayoutUpgrades(upgrades, options) {
  const prepared = new Map();
  for (const [index, upgrade] of upgrades.entries()) {
    if (!upgrade.preflight) continue;
    prepared.set(
      upgrade.id,
      await LAYOUT_UPGRADE_HANDLERS[upgrade.owner]({
        ...options,
        onSessionProcessed: createUpgradeProgress(options.reportProgress, {
          upgradeId: upgrade.id,
          upgradeIndex: index + 1,
          upgradeCount: upgrades.length,
        }),
      }),
    );
  }
  return prepared;
}

async function withLayoutUpgrade(options, operation) {
  const { base, created, signal } = options;
  signal?.throwIfAborted();
  const installedVersion = await readInstalledLayoutVersion(base, created);
  if (created || installedVersion === WORKSPACE_LAYOUT_VERSION) return operation(installedVersion);
  return withExclusiveWorkspaceStorage(options, async () =>
    operation(await readInstalledLayoutVersion(base, created)),
  );
}

export function upgradeWorkspaceLayout(options) {
  return withLayoutUpgrade(options, (version) => applyLayoutUpgrades(options, version));
}

export function prepareWorkspaceLayout(options) {
  return withLayoutUpgrade(options, async (version) => {
    const { base, backupBase, resetSections } = options;
    const backup = createSectionBackup(backupBase, base);
    for (const section of resetSections) await clearSection({ base, section, backup });
    const layoutMigrations = await migrateWorkspaceLayout({ base, backup });
    const layoutUpgrades = await applyLayoutUpgrades(options, version);
    assertWorkspaceLayoutReady(layoutUpgrades);
    await ensureRuntimeDirectories(base);
    const sessionTreeRecovery = await ensureSessionTree({ base, backupBase });
    return { layoutMigrations, layoutUpgrades, sessionTreeRecovery };
  });
}

async function applyLayoutUpgrades(options, installedVersion) {
  const { base, created, signal, reportProgress = ignoreSessionProgress } = options;
  if (installedVersion === WORKSPACE_LAYOUT_VERSION) {
    await assertWorkspaceQuarantineEmpty(base);
    if (created) await writeLayoutVersion(base, installedVersion);
    return [];
  }
  const applied = [];
  const upgrades = planWorkspaceLayoutUpgrades({ installedVersion });
  options = { ...options, reportProgress };
  const prepared = await prepareLayoutUpgrades(upgrades, options);
  for (const [index, upgrade] of upgrades.entries()) {
    signal?.throwIfAborted();
    const advanced = await applyLayoutUpgradeStep({
      options,
      prepared,
      applied,
      upgrade,
      upgradeIndex: index + 1,
      upgradeCount: upgrades.length,
    });
    if (!advanced) return applied;
  }
  return applied;
}

async function applyLayoutUpgradeStep({
  options,
  prepared,
  applied,
  upgrade,
  upgradeIndex,
  upgradeCount,
}) {
  const { base, signal, reportProgress } = options;
  const { id, owner, toVersion } = upgrade;
  try {
    const result = prepared.has(id)
      ? prepared.get(id)
      : await LAYOUT_UPGRADE_HANDLERS[owner]({
          ...options,
          onSessionProcessed: createUpgradeProgress(reportProgress, {
            upgradeId: id,
            upgradeIndex,
            upgradeCount,
          }),
        });
    signal?.throwIfAborted();
    if (upgrade.rebuildSessionTree === true)
      result.sessionTree = await rebuildStoredSessionTree({ base, backupBase: options.backupBase });
    await writeLayoutVersion(base, toVersion);
    applied.push({ id, toVersion, result });
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    applied.push({ id, toVersion, failed: describeLayoutFailure(error) });
    return false;
  }
}

function describeLayoutFailure(error) {
  return {
    code: String(error?.code || ""),
    message: String(error?.message || error),
    ...(error?.details === undefined ? {} : { details: error.details }),
  };
}

export async function ensureRuntimeDirectories(base) {
  for (const relativePath of WORKSPACE_RUNTIME_DIRECTORIES) {
    await mkdir(path.join(base, relativePath), { recursive: true });
  }
}

export async function repairMemorySection(base, fallbackLocale) {
  const config = await readConfigTarget(path.join(base, WORKSPACE_LAYOUT.CONFIG_FILE));
  return repairWorkspaceMemoryDocuments({
    base,
    locale: config.document?.preferences?.language || fallbackLocale,
  });
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
    const document = JSON.parse(raw);
    return { exists: true, raw, document: isPlainObject(document) ? document : null };
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
  const valid = current.exists && current.document !== null;
  const upgraded = upgradeConfigModelLibrary(valid ? current.document : baseValues);
  if (onlyInvalid && valid && !upgraded.report.changed)
    return { retired, repair: null, modelLibraryUpgrade: upgraded.report };
  if (current.exists && (!valid || upgraded.report.changed))
    await backup(WORKSPACE_LAYOUT.CONFIG_FILE);
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    baseValues,
    target: upgraded.document,
  });
  const next = `${JSON.stringify(repaired.document, null, 2)}\n`;
  if (current.raw !== next) await writeConfigDocument(filePath, repaired.document);
  return { retired, repair: repaired.report, modelLibraryUpgrade: upgraded.report };
}

export function resolveWorkspaceBackupBase(base, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, stamp);
}

export function createSectionBackup(backupBase, base) {
  const snapshots = new Map();
  return async function backup(relativePath) {
    if (snapshots.has(relativePath)) return snapshots.get(relativePath);
    const source = path.join(base, relativePath);
    if (!(await pathExists(source))) return null;
    const target = path.join(backupBase, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    snapshots.set(relativePath, target);
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

async function clearSection({ base, section, backup }) {
  const definition = WORKSPACE_SECTIONS[section];
  if (section === WORKSPACE_SECTION.RUNTIME) return clearRuntimeSection(base);
  for (const relativePath of definition.paths) {
    if (definition.backupOnReset) await backup(relativePath);
    await rm(path.join(base, relativePath), { recursive: true, force: true });
  }
  return undefined;
}
