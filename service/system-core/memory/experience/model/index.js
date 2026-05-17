/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../../utils/text.js";
import path from "node:path";

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

export async function readExperienceLessonsModel(storage, basePath = "") {
  if (!basePath) return {};
  const modelPath = storage.experienceLessonsModelPath(basePath);
  const raw = await storage.readJson(modelPath, {});
  return normalizeModelTree(raw);
}

export async function writeExperienceLessonsModel(storage, basePath = "", payload = {}) {
  if (!basePath) return false;
  const modelPath = storage.experienceLessonsModelPath(basePath);
  await storage.ensureDir(path.dirname(modelPath));
  await storage.writeJson(modelPath, normalizeModelTree(payload));
  return true;
}

export function upsertExperienceLessonsModelEntries(modelTree = {}, entries = []) {
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
