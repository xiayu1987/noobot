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
import path from "node:path";
import { fatalSystemError } from "../error/index.js";

const RESET_SECTION_PATHS = {
  memory: ["memory"],
  runtime: ["runtime"],
  service: ["services"],
  skill: ["skills"],
  config: ["config.json", "config.example.json"],
};
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) return isPlainObject(override) ? { ...override } : base;
  if (!isPlainObject(override)) return { ...base };
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function resolveTemplateBase(workspaceTemplatePath = "") {
  const configuredTemplatePath = String(workspaceTemplatePath || "").trim();
  if (!configuredTemplatePath) {
    throw fatalSystemError("workspaceTemplatePath required", {
      code: "FATAL_WORKSPACE_TEMPLATE_PATH_REQUIRED",
    });
  }
  return path.resolve(configuredTemplatePath);
}

async function resolveWorkspaceInitPaths({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
}) {
  const base = path.resolve(workspaceRoot, userId);
  const templateBase = resolveTemplateBase(workspaceTemplatePath);
  try {
    await access(templateBase);
  } catch {
    throw fatalSystemError(`workspace template missing: ${templateBase}`, {
      code: "FATAL_WORKSPACE_TEMPLATE_MISSING",
      details: { templateBase },
    });
  }
  await mkdir(path.resolve(workspaceRoot), { recursive: true });
  return { base, templateBase };
}

function normalizeResetSections(inputSections) {
  const all = Object.keys(RESET_SECTION_PATHS);
  if (!Array.isArray(inputSections) || !inputSections.length) return all;
  const normalized = Array.from(
    new Set(
      inputSections
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const invalid = normalized.filter((item) => !all.includes(item));
  if (invalid.length) {
    throw fatalSystemError(`invalid reset sections: ${invalid.join(", ")}`, {
      code: "FATAL_INVALID_RESET_SECTIONS",
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

export async function ensureUserWorkspaceInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
}) {
  const { base, templateBase } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });

  let baseExists = true;
  try {
    await access(base);
  } catch {
    baseExists = false;
  }

  if (baseExists) {
    const baseStat = await stat(base);
    if (!baseStat.isDirectory()) {
      throw fatalSystemError(`user workspace path is not a directory: ${base}`, {
        code: "FATAL_WORKSPACE_PATH_NOT_DIRECTORY",
        details: { base },
      });
    }
    // 目录已存在时，补齐模板中的缺失结构，不覆盖用户已有内容
    await cp(templateBase, base, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    return base;
  }

  await cp(templateBase, base, { recursive: true, force: false });
  return base;
}

export async function resetUserWorkspaceInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
}) {
  const { base, templateBase } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });
  await rm(base, { recursive: true, force: true });
  await cp(templateBase, base, { recursive: true, force: true });
  return base;
}

export async function resetUserWorkspaceKeepRuntimeInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
  resetSections = [],
}) {
  const { base, templateBase } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });
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
}

async function syncDirectoryIncremental(templateDir, userDir) {
  await mkdir(userDir, { recursive: true });
  const entries = await readdir(templateDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(templateDir, entry.name);
    const dst = path.join(userDir, entry.name);
    if (entry.isDirectory()) {
      await syncDirectoryIncremental(src, dst);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === "config.json") {
      const [templateRaw, userRaw] = await Promise.all([
        readFile(src, "utf8"),
        readFile(dst, "utf8").catch(() => "{}"),
      ]);
      const templateJson = JSON.parse(templateRaw || "{}");
      const userJson = JSON.parse(userRaw || "{}");
      const merged = deepMerge(templateJson, userJson);
      await writeFile(dst, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
      continue;
    }
    await cp(src, dst, { force: true });
  }
}

export async function syncUserWorkspaceFromTemplate({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
}) {
  const { base, templateBase } = await resolveWorkspaceInitPaths({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
  });
  await mkdir(base, { recursive: true });
  await syncDirectoryIncremental(templateBase, base);
  return base;
}
