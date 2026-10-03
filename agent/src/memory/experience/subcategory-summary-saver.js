/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { sanitizeFileName } from "@noobot/memory-protocol/text";
import { buildExperiencePatchSchema } from "@noobot/memory-protocol/experience/schema";
import { renderSectionLines } from "../utils/format.js";

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
  fields,
} = {}) {
  const schema = buildExperiencePatchSchema(schemaKey, fields);
  const safeDomainName = sanitizeFileName(domainName, "");
  if (!safeDomainName || !Array.isArray(categories) || !categories.length) return false;

  let writtenCount = 0;
  for (const category of categories) {
    const safeCategoryName = sanitizeFileName(category?.category, "");
    if (!safeCategoryName) continue;
    const subcategories = Array.isArray(category?.subcategories) ? category.subcategories : [];
    for (const subcategory of subcategories) {
      const safeSubcategoryName = sanitizeFileName(subcategory?.subcategory, "");
      if (!safeSubcategoryName) continue;
      const dirPath = path.join(periodDir, periodKey, safeDomainName, safeCategoryName);
      await storage.ensureDir(dirPath);
      const filePath = path.join(dirPath, `${safeSubcategoryName}.md`);
      const block = [
        `时间：${createdAt || new Date().toISOString()}`,
        `${schema.sourceLabel}：${(Array.isArray(sourceKeys) ? sourceKeys : []).join(", ")}`,
        "",
        ...schema.sections.flatMap((section) => [
          ...renderSectionLines(subcategory, [section]),
          "",
        ]),
      ].join("\n");
      await storage.appendMemoryDocument(schema.documentKind, filePath, block);
      writtenCount += 1;
    }
  }
  return writtenCount > 0;
}
