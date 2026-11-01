/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../text.js";
import { MEMORY_DOCUMENT_KIND, readMemoryDocumentBody, renderMemoryDocument } from "../document.js";
import { isPlainObject } from "@noobot/shared/value";

const EXPERIENCE_MODEL_ERROR_CODE = "EXPERIENCE_MODEL_DOCUMENT_INVALID";

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

function normalizeSubcategories(raw, categoryName) {
  if (!Array.isArray(raw)) {
    throw modelError(`experience subcategories must be an array: ${categoryName}`);
  }
  return dedupeTextList(raw.map((item) => sanitizeFileName(item, "")));
}

function normalizeNamedEntries(raw, normalizeValue) {
  const entries = new Map();
  for (const [key, value] of Object.entries(raw)) {
    const name = requireName(key, key);
    if (entries.has(name)) throw modelError(`experience model name repeated: ${name}`);
    entries.set(name, normalizeValue(value, name));
  }
  return Object.fromEntries(entries);
}

function normalizeCategories(raw, domainName) {
  if (!isPlainObject(raw)) {
    throw modelError(`experience categories must be an object: ${domainName}`);
  }
  return normalizeNamedEntries(raw, (value, name) =>
    normalizeSubcategories(value, `${domainName}.${name}`),
  );
}

export function normalizeExperienceModelTree(raw = {}) {
  if (!isPlainObject(raw)) throw modelError("experience model must be an object");
  return normalizeNamedEntries(raw, normalizeCategories);
}

function addDomain(tree, rawName, line) {
  const name = requireName(rawName, line);
  if (Object.hasOwn(tree, name)) throw modelError(`experience domain repeated: ${name}`);
  Object.defineProperty(tree, name, { value: {}, enumerable: true });
  return name;
}

function addCategory(tree, domain, rawName, line) {
  if (!domain) throw modelError(`category without domain: ${line}`);
  const name = requireName(rawName, line);
  const categories = tree[domain];
  if (Object.hasOwn(categories, name)) {
    throw modelError(`experience category repeated: ${domain}.${name}`);
  }
  Object.defineProperty(categories, name, { value: [], enumerable: true });
  return name;
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
      currentDomain = addDomain(out, domainMatched[1], line);
      currentCategory = "";
      continue;
    }
    const categoryMatched = /^CATEGORY:\s*(\S.*)$/.exec(line);
    if (categoryMatched) {
      currentCategory = addCategory(out, currentDomain, categoryMatched[1], line);
      continue;
    }
    const subMatched = /^-\s+(\S.*)$/.exec(line);
    if (!subMatched) throw modelError(`unknown experience model line: ${line}`);
    if (!currentCategory) throw modelError(`subcategory without category: ${line}`);
    out[currentDomain][currentCategory].push(requireName(subMatched[1], line));
  }
  return normalizeExperienceModelTree(out);
}

function appendCategoryLines(lines, categories) {
  for (const category of Object.keys(categories).sort()) {
    lines.push(`CATEGORY: ${category}`);
    for (const subcategory of categories[category].slice().sort()) {
      lines.push(`- ${subcategory}`);
    }
    lines.push("");
  }
}

export function renderExperienceModelText(modelTree = {}) {
  const tree = normalizeExperienceModelTree(modelTree);
  const lines = [];
  for (const domain of Object.keys(tree).sort()) {
    lines.push(`DOMAIN: ${domain}`);
    appendCategoryLines(lines, tree[domain]);
  }
  return renderMemoryDocument(MEMORY_DOCUMENT_KIND.EXPERIENCE_MODEL, lines.join("\n"));
}
