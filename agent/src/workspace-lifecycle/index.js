/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, stat } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  WORKSPACE_ASSET_SECTIONS,
  WORKSPACE_OPERATION,
  WORKSPACE_SECTION,
  normalizeWorkspaceSections,
} from "@noobot/workspace-protocol";
import { fatalSystemError } from "../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../shared/errors/constants.js";
import { FileMutationCoordinator } from "../shared/storage/file-mutation-coordinator.js";
import { applyWorkspaceAssets } from "./assets.js";
import {
  clearSection,
  createSectionBackup,
  ensureRuntimeDirectories,
  migrateWorkspaceLayout,
  repairConfigSection,
  repairMemorySection,
  resolveWorkspaceBackupBase,
  upgradeWorkspaceLayout,
} from "./sections.js";
import { text } from "@noobot/shared/value";

const workspaceMutationCoordinator = new FileMutationCoordinator({
  timeoutMessage: "workspace mutation lock timeout",
  timeoutErrorCode: "WORKSPACE_MUTATION_BUSY",
  operationName: "workspaceMutation.refreshLock",
});

function resolveWorkspaceMutationLockDir(workspaceRoot, userId) {
  return path.join(`${path.resolve(workspaceRoot)}.mutation-locks`, encodeURIComponent(userId));
}

async function resolveWorkspacePaths({ workspaceRoot, assetPackagePath, userId }) {
  const normalizedUserId = text(userId);
  const normalizedWorkspaceRoot = text(workspaceRoot);
  if (!normalizedUserId || !normalizedWorkspaceRoot) {
    throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
      details: { userId: normalizedUserId, workspaceRoot: normalizedWorkspaceRoot },
    });
  }
  const configuredAssetPath = text(assetPackagePath);
  if (!configuredAssetPath) {
    throw fatalSystemError(tSystem("init.workspaceTemplatePathRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_TEMPLATE_PATH_REQUIRED,
    });
  }
  const assetPackageBase = path.resolve(configuredAssetPath);
  try {
    await access(assetPackageBase);
  } catch {
    throw fatalSystemError(`${tSystem("init.workspaceTemplateMissing")}: ${assetPackageBase}`, {
      code: ERROR_CODE.FATAL_WORKSPACE_TEMPLATE_MISSING,
      details: { templateBase: assetPackageBase },
    });
  }
  const base = path.resolve(normalizedWorkspaceRoot, normalizedUserId);
  await mkdir(path.resolve(normalizedWorkspaceRoot), { recursive: true });
  return {
    base,
    assetPackageBase,
    mutationLockDir: resolveWorkspaceMutationLockDir(normalizedWorkspaceRoot, normalizedUserId),
  };
}

async function requireWorkspaceDirectory(base) {
  let baseStat;
  try {
    baseStat = await stat(base);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!baseStat.isDirectory()) {
    throw fatalSystemError(`${tSystem("init.userWorkspacePathNotDirectory")}: ${base}`, {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_NOT_DIRECTORY,
      details: { base },
    });
  }
  return true;
}

function normalizeSections(sections) {
  try {
    return normalizeWorkspaceSections(sections);
  } catch (error) {
    if (error?.code !== "WORKSPACE_SECTIONS_INVALID") throw error;
    throw fatalSystemError(`${tSystem("init.invalidResetSections")}: ${error.details.invalid}`, {
      code: ERROR_CODE.FATAL_INVALID_RESET_SECTIONS,
      details: error.details,
    });
  }
}

async function runWorkspaceOperation({
  base,
  assetPackageBase,
  operation,
  baseValues,
  sections,
  created,
  scopedSessionRoots,
  reportProgress,
}) {
  const backupBase = resolveWorkspaceBackupBase(base);
  const backup = createSectionBackup(backupBase, base);
  const selected = new Set(sections);
  await mkdir(base, { recursive: true });
  if (operation === WORKSPACE_OPERATION.RESET) {
    for (const section of sections) await clearSection({ base, section, backup });
  }
  const report = { operation, layoutMigrations: await migrateWorkspaceLayout({ base, backup }) };
  report.layoutUpgrades = await upgradeWorkspaceLayout({
    base,
    backupBase,
    created,
    scopedSessionRoots,
    reportProgress,
  });
  await ensureRuntimeDirectories(base);
  report.memory = await repairMemorySection(base);
  if (operation !== WORKSPACE_OPERATION.RESET || selected.has(WORKSPACE_SECTION.CONFIG)) {
    report.config = await repairConfigSection({
      base,
      baseValues,
      backup,
      onlyInvalid: operation === WORKSPACE_OPERATION.REPAIR,
    });
  }
  const assetSections = WORKSPACE_ASSET_SECTIONS.filter((name) => selected.has(name));
  report.assets = await applyWorkspaceAssets({
    base,
    assetPackageBase,
    operation,
    sections: assetSections,
  });
  return report;
}

async function withWorkspace(options, operation, sections) {
  if (!Array.isArray(options?.scopedSessionRoots) || !options.scopedSessionRoots.length) {
    throw new TypeError("workspace lifecycle requires scopedSessionRoots");
  }
  const { base, assetPackageBase, mutationLockDir } = await resolveWorkspacePaths(options);
  return workspaceMutationCoordinator.run(mutationLockDir, async () => {
    const existed = await requireWorkspaceDirectory(base);
    const effectiveOperation =
      !existed && operation === WORKSPACE_OPERATION.REPAIR ? WORKSPACE_OPERATION.CREATE : operation;
    const report = await runWorkspaceOperation({
      base,
      assetPackageBase,
      operation: effectiveOperation,
      baseValues: options.baseValues ?? {},
      sections,
      created: !existed,
      scopedSessionRoots: options.scopedSessionRoots,
      reportProgress: options.onProgress,
    });
    return { base, report };
  });
}

export async function ensureUserWorkspace(options) {
  const { base, mutationLockDir } = await resolveWorkspacePaths(options);
  const existed = await workspaceMutationCoordinator.run(mutationLockDir, () =>
    requireWorkspaceDirectory(base),
  );
  if (existed) return base;
  return (await repairUserWorkspace(options)).base;
}

export function repairUserWorkspace(options) {
  return withWorkspace(options, WORKSPACE_OPERATION.REPAIR, normalizeSections());
}

export async function syncUserWorkspace(options) {
  return (await withWorkspace(options, WORKSPACE_OPERATION.SYNC, normalizeSections())).base;
}

export async function resetUserWorkspace({ sections = [], ...options }) {
  return (await withWorkspace(options, WORKSPACE_OPERATION.RESET, normalizeSections(sections)))
    .base;
}
