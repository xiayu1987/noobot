/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../text.js";
import { MEMORY_DOCUMENT_KIND, readMemoryDocumentBody, renderMemoryDocument } from "../document.js";

export const EXPERIENCE_MODEL_ERROR_CODE = "EXPERIENCE_MODEL_DOCUMENT_INVALID";

function modelError(message) {
  const error = new Error(message);
  error.code = EXPERIENCE_MODEL_ERROR_CODE;
  return error;
}

function requireName(raw, line) {
  const name = sanitizeFileName(raw, "");
  if (!name) throw modelError(`empty experience model name: ${line}`);
  return name;
}

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
  const lines = readMemoryDocumentBody(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL, raw).split("\n");
  const out = {};
  let currentDomain = "";
  let currentCategory = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const domainMatched = /^DOMAIN:\s*(\S.*)$/.exec(line);
    if (domainMatched) {
      currentDomain = requireName(domainMatched[1], line);
      if (out[currentDomain]) throw modelError(`experience domain repeated: ${currentDomain}`);
      out[currentDomain] = {};
      currentCategory = "";
      continue;
    }
    const categoryMatched = /^CATEGORY:\s*(\S.*)$/.exec(line);
    if (categoryMatched) {
      if (!currentDomain) throw modelError(`category without domain: ${line}`);
      currentCategory = requireName(categoryMatched[1], line);
      if (out[currentDomain][currentCategory]) {
        throw modelError(`experience category repeated: ${currentDomain}.${currentCategory}`);
      }
      out[currentDomain][currentCategory] = [];
      continue;
    }
    const subMatched = /^-\s+(\S.*)$/.exec(line);
    if (!subMatched) throw modelError(`unknown experience model line: ${line}`);
    if (!currentCategory) throw modelError(`subcategory without category: ${line}`);
    out[currentDomain][currentCategory].push(requireName(subMatched[1], line));
  }
  return normalizeExperienceModelTree(out);
}

export function renderExperienceModelText(modelTree = {}) {
  const tree = normalizeExperienceModelTree(modelTree);
  const lines = [];
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
  return renderMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL, lines.join("\n"));
}
