/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeFileName } from "@noobot/memory-protocol/text";
import { filePath as path } from "@noobot/path-resolver";
import {
  normalizeExperienceModelTree,
  parseExperienceModelText,
  renderExperienceModelText,
} from "@noobot/memory-protocol/experience/model-text";

export async function readExperienceModel(storage, basePath = "") {
  if (!basePath) return {};
  return parseExperienceModelText(
    await storage.readText(storage.experienceModelPath(basePath), ""),
  );
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
