/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { CONFIG_DOCUMENT_SCOPE, repairConfigDocument } from "@noobot/agent-config-protocol";
import { fatalSystemError } from "../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../shared/errors/constants.js";
import { migrateLegacyMemoryFiles } from "../memory/migration.js";
import { FileMutationCoordinator } from "../shared/storage/file-mutation-coordinator.js";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";

const RESET_SECTION_PATHS = {
  memory: ["memory"],
  runtime: ["runtime"],
  service: ["services"],
  skill: ["skills"],
  config: ["config.json", "config.example.json"],
};

const SYNC_PRESERVE_EXISTING_ROOTS = new Set(["memory"]);
const workspaceMutationCoordinator = new FileMutationCoordinator({
  timeoutMessage: "workspace mutation lock timeout",
  timeoutErrorCode: "WORKSPACE_MUTATION_BUSY",
  operationName: "workspaceMutation.refreshLock",
});

function resolveWorkspaceMutationLockDir(workspaceRoot, userId) {
  const normalizedRoot = path.resolve(String(workspaceRoot || "").trim());
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedRoot || !normalizedUserId) {
    throw new TypeError("workspace mutation lock requires workspaceRoot and userId");
  }
  const lockRoot = `${normalizedRoot}.mutation-locks`;
  return path.join(lockRoot, encodeURIComponent(normalizedUserId));
}

function withWorkspaceMutation(lockDir, operation) {
  return workspaceMutationCoordinator.run(lockDir, operation);
}

function resolveTemplateBase(workspaceTemplatePath = "") {
  const configuredTemplatePath = String(workspaceTemplatePath || "").trim();
  if (!configuredTemplatePath) {
    throw fatalSystemError(tSystem("init.workspaceTemplatePathRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_TEMPLATE_PATH_REQUIRED,
    });
  }
  return path.resolve(configuredTemplatePath);
}

async function resolveWorkspaceInitPaths({ workspaceRoot, workspaceTemplatePath = "", userId }) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedUserId || !normalizedWorkspaceRoot) {
    throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
      code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
      details: { userId: normalizedUserId, workspaceRoot: normalizedWorkspaceRoot },
    });
  }
  const base = path.resolve(normalizedWorkspaceRoot, normalizedUserId);
  const templateBase = resolveTemplateBase(workspaceTemplatePath);
  try {
    await access(templateBase);
  } catch {
    throw fatalSystemError(`${tSystem("init.workspaceTemplateMissing")}: ${templateBase}`, {
      code: ERROR_CODE.FATAL_WORKSPACE_TEMPLATE_MISSING,
      details: { templateBase },
    });
  }
  await mkdir(path.resolve(normalizedWorkspaceRoot), { recursive: true });
  return {
    base,
    templateBase,
    mutationLockDir: resolveWorkspaceMutationLockDir(normalizedWorkspaceRoot, normalizedUserId),
  };
}

function normalizeResetSections(inputSections) {
  const all = Object.keys(RESET_SECTION_PATHS);
  if (!Array.isArray(inputSections) || !inputSections.length) return all;
  const normalized = Array.from(
    new Set(
      inputSections
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );
  const invalid = normalized.filter((item) => !all.includes(item));
  if (invalid.length) {
    throw fatalSystemError(`${tSystem("init.invalidResetSections")}: ${invalid.join(", ")}`, {
      code: ERROR_CODE.FATAL_INVALID_RESET_SECTIONS,
      details: { invalid, allowed: all },
    });
  }
  return normalized;
}

async function pathExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readConfigDocumentForRepair(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    try {
      return JSON.parse(raw);
    } catch {
      await rename(filePath, `${filePath}.invalid-${Date.now()}.json`);
      return {};
    }
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
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

export async function ensureUserWorkspaceInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
  globalConfig = {},
}) {
  const { base, templateBase, mutationLockDir } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });

  return withWorkspaceMutation(mutationLockDir, async () => {
    let baseExists = true;
    try {
      await access(base);
    } catch {
      baseExists = false;
    }

    if (baseExists) {
      const baseStat = await stat(base);
      if (!baseStat.isDirectory()) {
        throw fatalSystemError(`${tSystem("init.userWorkspacePathNotDirectory")}: ${base}`, {
          code: ERROR_CODE.FATAL_WORKSPACE_PATH_NOT_DIRECTORY,
          details: { base },
        });
      }
      await migrateLegacyMemoryFiles(base);
      await syncDirectoryIncremental(templateBase, base, "", globalConfig);
      return base;
    }

    await cp(templateBase, base, { recursive: true, force: false });
    await migrateLegacyMemoryFiles(base);
    return base;
  });
}

export async function resetUserWorkspaceInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
}) {
  const { base, templateBase, mutationLockDir } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });
  return withWorkspaceMutation(mutationLockDir, async () => {
    await rm(base, { recursive: true, force: true });
    await cp(templateBase, base, { recursive: true, force: true });
    return base;
  });
}

export async function resetUserWorkspaceKeepRuntimeInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
  resetSections = [],
}) {
  const { base, templateBase, mutationLockDir } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });
  return withWorkspaceMutation(mutationLockDir, async () => {
    const sections = normalizeResetSections(resetSections);
    await mkdir(base, { recursive: true });
    const relativePaths = Array.from(
      new Set(sections.flatMap((section) => RESET_SECTION_PATHS[section] || [])),
    );
    for (const relPath of relativePaths) {
      const srcPath = path.join(templateBase, relPath);
      const dstPath = path.join(base, relPath);
      await rm(dstPath, { recursive: true, force: true });
      if (!(await pathExists(srcPath))) continue;
      await mkdir(path.dirname(dstPath), { recursive: true });
      await cp(srcPath, dstPath, { recursive: true, force: true });
    }
    return base;
  });
}

async function syncDirectoryIncremental(templateDir, userDir, relativeRoot = "", baseValues = {}) {
  await mkdir(userDir, { recursive: true });
  const entries = await readdir(templateDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(templateDir, entry.name);
    const dst = path.join(userDir, entry.name);
    const relativePath = path.join(relativeRoot, entry.name);
    const rootName = String(relativePath || "").split(path.sep)[0] || "";
    const preserveExisting = SYNC_PRESERVE_EXISTING_ROOTS.has(rootName);
    if (entry.isDirectory()) {
      await syncDirectoryIncremental(src, dst, relativePath, baseValues);
      continue;
    }
    if (!entry.isFile()) continue;
    if (["config.json", "config.example.json"].includes(entry.name)) {
      const [templateRaw, userJson] = await Promise.all([
        readFile(src, "utf8"),
        readConfigDocumentForRepair(dst),
      ]);
      const templateJson = JSON.parse(templateRaw);
      const merged = repairConfigDocument({
        scope: CONFIG_DOCUMENT_SCOPE.USER,
        baseValues,
        overrideValues: templateJson,
        target: userJson,
      }).document;
      await writeConfigDocument(dst, merged);
      continue;
    }
    await cp(src, dst, { force: !preserveExisting, errorOnExist: false });
  }
}

export async function syncUserWorkspaceFromTemplate({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
  baseValues = {},
}) {
  const { base, templateBase, mutationLockDir } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });
  return withWorkspaceMutation(mutationLockDir, async () => {
    await mkdir(base, { recursive: true });
    await migrateLegacyMemoryFiles(base);
    await syncDirectoryIncremental(templateBase, base, "", baseValues);
    return base;
  });
}

export async function ensureUserWorkspaceMissingFilesFromTemplate({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
  relativePaths = [],
}) {
  const { base, templateBase, mutationLockDir } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });

  const normalizedRelativePaths = Array.from(
    new Set(
      (Array.isArray(relativePaths) ? relativePaths : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );

  return withWorkspaceMutation(mutationLockDir, async () => {
    if (!normalizedRelativePaths.length) {
      await mkdir(base, { recursive: true });
      await cp(templateBase, base, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      return base;
    }

    await mkdir(base, { recursive: true });
    for (const relPath of normalizedRelativePaths) {
      const srcPath = path.join(templateBase, relPath);
      const dstPath = path.join(base, relPath);
      if (await pathExists(dstPath)) continue;
      if (!(await pathExists(srcPath))) continue;
      await mkdir(path.dirname(dstPath), { recursive: true });
      await cp(srcPath, dstPath, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    }
    return base;
  });
}
