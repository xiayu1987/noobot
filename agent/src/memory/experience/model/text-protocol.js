/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../../utils/text.js";

export function normalizeExperienceModelTree(raw = {}) {
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
        categoriesOut[categoryName] = dedupeTextList(
          (Array.isArray(subcategoriesRaw) ? subcategoriesRaw : []).map((item) =>
            sanitizeFileName(item, ""),
          ),
        ).filter(Boolean);
      }
    }
    out[domainName] = categoriesOut;
  }
  return out;
}

export function parseExperienceModelText(raw = "") {
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
    if (!subMatched || !currentDomain || !currentCategory) continue;
    const subcategory = sanitizeFileName(subMatched[1], "");
    if (subcategory && !out[currentDomain][currentCategory].includes(subcategory)) {
      out[currentDomain][currentCategory].push(subcategory);
    }
  }
  return normalizeExperienceModelTree(out);
}

export function renderExperienceModelText(modelTree = {}) {
  const tree = normalizeExperienceModelTree(modelTree);
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
