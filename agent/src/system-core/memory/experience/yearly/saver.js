/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { sanitizeFileName } from "../../utils/text.js";

export async function saveYearlyDomainSummary({
  storage,
  basePath = "",
  yearKey = "",
  domainName = "",
  categories = [],
  createdAt = "",
  sourceMonths = [],
} = {}) {
  const safeDomainName = sanitizeFileName(domainName, "");
  if (!safeDomainName || !Array.isArray(categories) || !categories.length) return false;
  let writtenCount = 0;
  for (const category of categories) {
    const safeCategoryName = sanitizeFileName(category?.category_name, "");
    if (!safeCategoryName) continue;
    const subcategories = Array.isArray(category?.subcategories)
      ? category.subcategories
      : [];
    for (const subcategory of subcategories) {
      const safeSubcategoryName = sanitizeFileName(subcategory?.subcategory_name, "");
      if (!safeSubcategoryName) continue;
      const dirPath = path.join(
        storage.yearlySummaryDir(basePath),
        yearKey,
        safeDomainName,
        safeCategoryName,
      );
      await storage.ensureDir(dirPath);
      const filePath = path.join(dirPath, `${safeSubcategoryName}.md`);
      const block = [
        `时间：${createdAt || new Date().toISOString()}`,
        `来源月：${(Array.isArray(sourceMonths) ? sourceMonths : []).join(", ")}`,
        "",
        "底层原则（Principles）：",
        ...(Array.isArray(subcategory?.yearly_principles) &&
        subcategory.yearly_principles.length
          ? subcategory.yearly_principles.map((item) => `- ${item}`)
          : ["- （无）"]),
        "",
        "战略反思（Strategic Reflections）：",
        ...(Array.isArray(subcategory?.strategic_reflections) &&
        subcategory.strategic_reflections.length
          ? subcategory.strategic_reflections.map((item) => `- ${item}`)
          : ["- （无）"]),
        "",
      ].join("\n");
      await storage.appendText(filePath, block);
      writtenCount += 1;
    }
  }
  return writtenCount > 0;
}

