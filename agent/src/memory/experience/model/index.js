/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeFileName } from "../../utils/text.js";
import { filePath as path } from "@noobot/path-resolver";
import { ensureUserWorkspaceMissingFilesFromTemplate } from "../../../workspace-lifecycle/index.js";
import {
  normalizeExperienceModelTree,
  parseExperienceModelText,
  renderExperienceModelText,
} from "./text-protocol.js";

function resolveUserIdFromBasePath(storage, basePath = "") {
  const workspaceRoot = path.resolve(String(storage?.globalConfig?.workspaceRoot || "").trim());
  const normalizedBasePath = path.resolve(String(basePath || "").trim());
  if (!workspaceRoot || !normalizedBasePath) return "";
  const relative = path.relative(workspaceRoot, normalizedBasePath);
  if (!relative || relative.startsWith("..")) return "";
  const userId = String(relative || "").split(path.sep)[0] || "";
  return String(userId || "").trim();
}

async function ensureExperienceModelIfMissing(storage, basePath = "") {
  const modelPath = storage.experienceModelPath(basePath);
  if (await storage.fileExists(modelPath)) return true;
  const workspaceRoot = String(storage?.globalConfig?.workspaceRoot || "").trim();
  const workspaceTemplatePath = String(storage?.globalConfig?.workspaceTemplatePath || "").trim();
  const userId = resolveUserIdFromBasePath(storage, basePath);
  if (!workspaceRoot || !workspaceTemplatePath || !userId) return false;
  await ensureUserWorkspaceMissingFilesFromTemplate({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
    relativePaths: ["memory/experience-model.md"],
  });
  return storage.fileExists(modelPath);
}

export async function readExperienceModel(storage, basePath = "") {
  if (!basePath) return {};
  const modelPath = storage.experienceModelPath(basePath);
  await ensureExperienceModelIfMissing(storage, basePath);
  const rawText = await storage.readText(modelPath, "");
  return String(rawText || "").trim() ? parseExperienceModelText(rawText) : {};
}

export async function writeExperienceModel(storage, basePath = "", payload = {}) {
  if (!basePath) return false;
  const modelPath = storage.experienceModelPath(basePath);
  await storage.ensureDir(path.dirname(modelPath));
  await storage.writeText(modelPath, renderExperienceModelText(payload));
  return true;
}

export function upsertExperienceModelEntries(modelTree = {}, entries = []) {
  const tree = normalizeExperienceModelTree(modelTree);
  let changed = false;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const domainName = sanitizeFileName(entry?.domain_name, "");
    if (!domainName) continue;
    if (!tree[domainName]) {
      tree[domainName] = {};
      changed = true;
    }
    const categoryName = sanitizeFileName(entry?.category_name, "");
    if (!categoryName) continue;
    if (!Array.isArray(tree[domainName][categoryName])) {
      tree[domainName][categoryName] = [];
      changed = true;
    }
    const subcategoryName = sanitizeFileName(entry?.subcategory_name, "");
    if (!subcategoryName) continue;
    if (!tree[domainName][categoryName].includes(subcategoryName)) {
      tree[domainName][categoryName].push(subcategoryName);
      changed = true;
    }
  }
  return { changed, model: tree };
}
