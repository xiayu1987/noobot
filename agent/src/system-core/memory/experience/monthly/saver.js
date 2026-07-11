/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../../../utils/path-resolver.js";
import { sanitizeFileName } from "../../utils/text.js";

export async function saveMonthlyDomainSummary({
  storage,
  basePath = "",
  monthKey = "",
  domainName = "",
  categories = [],
  createdAt = "",
  sourceWeeks = [],
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
        storage.monthlySummaryDir(basePath),
        monthKey,
        safeDomainName,
        safeCategoryName,
      );
      await storage.ensureDir(dirPath);
      const filePath = path.join(dirPath, `${safeSubcategoryName}.md`);
      const block = [
        `时间：${createdAt || new Date().toISOString()}`,
        `来源周：${(Array.isArray(sourceWeeks) ? sourceWeeks : []).join(", ")}`,
        "",
        "规律（Patterns）：",
        ...(Array.isArray(subcategory?.patterns) && subcategory.patterns.length
          ? subcategory.patterns.map((item) => `- ${item}`)
          : ["- （无）"]),
        "",
        "方法论（Methodologies）：",
        ...(Array.isArray(subcategory?.methodologies) && subcategory.methodologies.length
          ? subcategory.methodologies.map((item) => `- ${item}`)
          : ["- （无）"]),
        "",
      ].join("\n");
      await storage.appendText(filePath, block);
      writtenCount += 1;
    }
  }
  return writtenCount > 0;
}

