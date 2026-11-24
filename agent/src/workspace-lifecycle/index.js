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
  createSectionBackup,
  prepareWorkspaceLayout,
  repairConfigSection,
  repairMemorySection,
  resolveWorkspaceBackupBase,
} from "./sections.js";
import { text } from "@noobot/shared/value";
import { requireStorageService } from "../session/storage-service.js";
import { retireDirectoryLockIfPresent } from "./directory-lock-retirement.js";
import { recoverWorkspaceAttachmentCatalogs } from "./attachment-catalog-upgrade.js";

const workspaceMutationCoordinator = new FileMutationCoordinator({
  timeoutMessage: "workspace mutation lock timeout",
  timeoutErrorCode: "WORKSPACE_MUTATION_BUSY",
  operationName: "workspaceMutation.refreshLock",
});

function resolveWorkspaceMutationLockPath(workspaceRoot, userId) {
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
  const mutationLockPath = resolveWorkspaceMutationLockPath(
    normalizedWorkspaceRoot,
    normalizedUserId,
  );
  await retireDirectoryLockIfPresent(mutationLockPath);
  return {
    base,
    assetPackageBase,
    mutationLockPath,
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
  storageService,
  reportProgress,
  readSessionOperationInput,
  targetStorageBudget,
  startupStorage,
  signal,
}) {
  const backupBase = resolveWorkspaceBackupBase(base);
  const backup = createSectionBackup(backupBase, base);
  const selected = new Set(sections);
  await mkdir(base, { recursive: true });
  const layout = await prepareWorkspaceLayout({
    base,
    backupBase,
    resetSections: operation === WORKSPACE_OPERATION.RESET ? sections : [],
    created,
    scopedSessionRoots,
    storageService,
    reportProgress,
    readSessionOperationInput,
    targetStorageBudget,
    startupStorage,
    signal,
  });
  const report = { operation, ...layout };
  if (operation === WORKSPACE_OPERATION.REPAIR) {
    await recoverWorkspaceAttachmentCatalogs(base);
  }
  if (operation !== WORKSPACE_OPERATION.RESET || selected.has(WORKSPACE_SECTION.CONFIG)) {
    const { modelLibraryUpgrade, ...config } = await repairConfigSection({
      base,
      baseValues,
      backup,
      onlyInvalid: operation === WORKSPACE_OPERATION.REPAIR,
    });
    report.config = config;
    report.modelLibraryUpgrade = modelLibraryUpgrade;
  }
  report.memory = await repairMemorySection(base, baseValues.preferences?.language);
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
  const { base, assetPackageBase, mutationLockPath } = await resolveWorkspacePaths(options);
  return workspaceMutationCoordinator.run(mutationLockPath, async () => {
    const existed = await requireWorkspaceDirectory(base);
    if (existed && operation === WORKSPACE_OPERATION.CREATE) return { base };
    if (!Array.isArray(options.scopedSessionRoots) || !options.scopedSessionRoots.length) {
      throw new TypeError("workspace lifecycle requires scopedSessionRoots");
    }
    const storageService = requireStorageService(options.storageService, "workspace lifecycle");
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
      storageService,
      reportProgress: options.onProgress,
      readSessionOperationInput: options.readSessionOperationInput,
      targetStorageBudget: options.targetStorageBudget,
      startupStorage: options.startupStorage,
      signal: options.signal,
    });
    return { base, report };
  });
}

export async function ensureUserWorkspace(options) {
  return (await withWorkspace(options, WORKSPACE_OPERATION.CREATE, normalizeSections())).base;
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
