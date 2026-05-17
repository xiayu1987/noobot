/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../../utils/text.js";
import path from "node:path";
import { ensureUserWorkspaceMissingFilesFromTemplate } from "../../../init/index.js";

function normalizeModelTree(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [domainKey, categoriesRaw] of Object.entries(raw)) {
    const domainName = sanitizeFileName(domainKey, "");
    if (!domainName) continue;
    const categoriesOut = {};
    if (categoriesRaw && typeof categoriesRaw === "object") {
      for (const [categoryKey, subcategoriesRaw] of Object.entries(categoriesRaw)) {
        const categoryName = sanitizeFileName(categoryKey, "");
        if (!categoryName) continue;
        const normalizedSubcategories = dedupeTextList(
          (Array.isArray(subcategoriesRaw) ? subcategoriesRaw : []).map((item) =>
            sanitizeFileName(item, ""),
          ),
        ).filter(Boolean);
        categoriesOut[categoryName] = normalizedSubcategories;
      }
    }
    out[domainName] = categoriesOut;
  }
  return out;
}

function resolveUserIdFromBasePath(storage, basePath = "") {
  const workspaceRoot = path.resolve(String(storage?.globalConfig?.workspaceRoot || "").trim());
  const normalizedBasePath = path.resolve(String(basePath || "").trim());
  if (!workspaceRoot || !normalizedBasePath) return "";
  const relative = path.relative(workspaceRoot, normalizedBasePath);
  if (!relative || relative.startsWith("..")) return "";
  const userId = String(relative || "").split(path.sep)[0] || "";
  return String(userId || "").trim();
}

async function ensureSummaryPipelineModelIfMissing(storage, basePath = "") {
  const modelPath = storage.summaryPipelineModelPath(basePath);
  if (await storage.fileExists(modelPath)) return true;
  const workspaceRoot = String(storage?.globalConfig?.workspaceRoot || "").trim();
  const workspaceTemplatePath = String(
    storage?.globalConfig?.workspaceTemplatePath || "",
  ).trim();
  const userId = resolveUserIdFromBasePath(storage, basePath);
  if (!workspaceRoot || !workspaceTemplatePath || !userId) return false;
  await ensureUserWorkspaceMissingFilesFromTemplate({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
    relativePaths: ["memory/summary-pipeline-model.json"],
  });
  return storage.fileExists(modelPath);
}

export async function readSummaryPipelineModel(storage, basePath = "") {
  if (!basePath) return {};
  const modelPath = storage.summaryPipelineModelPath(basePath);
  await ensureSummaryPipelineModelIfMissing(storage, basePath);
  let raw = await storage.readJson(modelPath, null);
  if (raw && typeof raw === "object") {
    return normalizeModelTree(raw);
  }
  const legacyModelPath = path.join(basePath, "memory/experience-lessons-model.json");
  raw = await storage.readJson(legacyModelPath, null);
  if (!(raw && typeof raw === "object")) return {};
  const normalized = normalizeModelTree(raw);
  await writeSummaryPipelineModel(storage, basePath, normalized);
  return normalized;
}

export async function writeSummaryPipelineModel(storage, basePath = "", payload = {}) {
  if (!basePath) return false;
  const modelPath = storage.summaryPipelineModelPath(basePath);
  await storage.ensureDir(path.dirname(modelPath));
  await storage.writeJson(modelPath, normalizeModelTree(payload));
  return true;
}

export function upsertSummaryPipelineModelEntries(modelTree = {}, entries = []) {
  const tree = normalizeModelTree(modelTree);
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

// Backward-compatible aliases (deprecated)
export const readExperienceLessonsModel = readSummaryPipelineModel;
export const writeExperienceLessonsModel = writeSummaryPipelineModel;
export const upsertExperienceLessonsModelEntries = upsertSummaryPipelineModelEntries;
