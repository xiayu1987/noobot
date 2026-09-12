/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { sanitizeFileName } from "../utils/text.js";
import { EXPERIENCE_PATCH_SCHEMA } from "./schema-config.js";

function renderSectionLines(subcategory = {}, sections = []) {
  const lines = [];
  for (const { heading, field } of sections) {
    const values = Array.isArray(subcategory?.[field]) ? subcategory[field] : [];
    lines.push(heading);
    lines.push(...(values.length ? values.map((item) => `- ${item}`) : ["- （无）"]));
    lines.push("");
  }
  return lines;
}

export async function saveSubcategoryDomainSummary({
  schemaKey = "",
  storage,
  basePath = "",
  periodKey = "",
  periodDir,
  domainName = "",
  categories = [],
  createdAt = "",
  sourceKeys = [],
} = {}) {
  const schema = EXPERIENCE_PATCH_SCHEMA[schemaKey];
  if (!schema) {
    throw new Error(`unknown experience patch schema: ${schemaKey}`);
  }
  const safeDomainName = sanitizeFileName(domainName, "");
  if (!safeDomainName || !Array.isArray(categories) || !categories.length) return false;

  let writtenCount = 0;
  for (const category of categories) {
    const safeCategoryName = sanitizeFileName(category?.category_name, "");
    if (!safeCategoryName) continue;
    const subcategories = Array.isArray(category?.subcategories) ? category.subcategories : [];
    for (const subcategory of subcategories) {
      const safeSubcategoryName = sanitizeFileName(subcategory?.subcategory_name, "");
      if (!safeSubcategoryName) continue;
      const dirPath = path.join(periodDir, periodKey, safeDomainName, safeCategoryName);
      await storage.ensureDir(dirPath);
      const filePath = path.join(dirPath, `${safeSubcategoryName}.md`);
      const block = [
        `时间：${createdAt || new Date().toISOString()}`,
        `${schema.sourceLabel}：${(Array.isArray(sourceKeys) ? sourceKeys : []).join(", ")}`,
        "",
        ...renderSectionLines(subcategory, schema.sections),
      ].join("\n");
      await storage.appendText(filePath, block);
      writtenCount += 1;
    }
  }
  return writtenCount > 0;
}
