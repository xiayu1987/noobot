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
  WORKSPACE_RUNTIME_DIRECTORIES,
  WORKSPACE_SECTION,
  WORKSPACE_SECTIONS,
  planWorkspaceLayoutMigrations,
} from "@noobot/workspace-protocol";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { repairWorkspaceMemoryDocuments } from "../memory/storage/repair.js";

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

export async function ensureRuntimeDirectories(base) {
  for (const relativePath of WORKSPACE_RUNTIME_DIRECTORIES) {
    await mkdir(path.join(base, relativePath), { recursive: true });
  }
}

export function repairMemorySection(base) {
  return repairWorkspaceMemoryDocuments({ base });
}

function writeConfigDocument(filePath, document) {
  return writeFileAtomic({
    filePath,
    content: `${JSON.stringify(document, null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
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

export function createSectionBackup(base, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupBase = path.join(base, WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR, stamp);
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
