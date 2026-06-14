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

async function ensureExperienceModelIfMissing(storage, basePath = "") {
  const modelPath = storage.experienceModelPath(basePath);
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
    relativePaths: ["memory/experience-model.md"],
  });
  return storage.fileExists(modelPath);
}

function parseExperienceModelText(raw = "") {
  const lines = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const out = {};
  let currentDomain = "";
  let currentCategory = "";
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) continue;
    const domainMatched = /^DOMAIN:\s*(.+)$/i.exec(line);
    if (domainMatched) {
      currentDomain = sanitizeFileName(domainMatched[1], "");
      if (!currentDomain) continue;
      if (!out[currentDomain]) out[currentDomain] = {};
      currentCategory = "";
      continue;
    }
    const categoryMatched = /^CATEGORY:\s*(.+)$/i.exec(line);
    if (categoryMatched) {
      if (!currentDomain) continue;
      currentCategory = sanitizeFileName(categoryMatched[1], "");
      if (!currentCategory) continue;
      if (!Array.isArray(out[currentDomain][currentCategory])) {
        out[currentDomain][currentCategory] = [];
      }
      continue;
    }
    const subMatched = /^-\s*(.+)$/.exec(line);
    if (subMatched) {
      if (!currentDomain || !currentCategory) continue;
      const subcategory = sanitizeFileName(subMatched[1], "");
      if (!subcategory) continue;
      if (!out[currentDomain][currentCategory].includes(subcategory)) {
        out[currentDomain][currentCategory].push(subcategory);
      }
    }
  }
  return normalizeModelTree(out);
}

function renderExperienceModelText(modelTree = {}) {
  const tree = normalizeModelTree(modelTree);
  const lines = ["【经验教训字段模型】"];
  for (const domain of Object.keys(tree).sort()) {
    lines.push(`DOMAIN: ${domain}`);
    const categories = tree[domain] && typeof tree[domain] === "object" ? tree[domain] : {};
    for (const category of Object.keys(categories).sort()) {
      lines.push(`CATEGORY: ${category}`);
      for (const subcategory of dedupeTextList(categories[category]).sort()) {
        lines.push(`- ${subcategory}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export async function readExperienceModel(storage, basePath = "") {
  if (!basePath) return {};
  const modelPath = storage.experienceModelPath(basePath);
  await ensureExperienceModelIfMissing(storage, basePath);
  const rawText = await storage.readText(modelPath, "");
  if (String(rawText || "").trim()) {
    return parseExperienceModelText(rawText);
  }
  const legacyJsonPath = modelPath.replace(/\.md$/i, ".json");
  const legacyJson = await storage.readJson(legacyJsonPath, null);
  if (!(legacyJson && typeof legacyJson === "object")) return {};
  return normalizeModelTree(legacyJson);
}

export async function writeExperienceModel(storage, basePath = "", payload = {}) {
  if (!basePath) return false;
  const modelPath = storage.experienceModelPath(basePath);
  await storage.ensureDir(path.dirname(modelPath));
  await storage.writeText(modelPath, renderExperienceModelText(payload));
  return true;
}

export function upsertExperienceModelEntries(modelTree = {}, entries = []) {
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
