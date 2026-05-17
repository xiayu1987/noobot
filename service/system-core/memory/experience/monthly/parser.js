/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseJsonWithLogging } from "../../parsers/json-parser.js";
import { sanitizeFileName, dedupeTextList } from "../../utils/text.js";

export function normalizeMonthlySummaryOutput(
  rawContent,
  fallbackDomainName = "",
  { onParseError = null } = {},
) {
  const { parsed } = parseJsonWithLogging({
    rawContent,
    stage: `monthly_summary:${fallbackDomainName}`,
    defaultValue: {},
    onError: onParseError,
  });
  const domainName = sanitizeFileName(
    parsed?.domain_name || fallbackDomainName,
    fallbackDomainName,
  );
  const categories = [];
  for (const category of Array.isArray(parsed?.categories) ? parsed.categories : []) {
    const categoryName = sanitizeFileName(category?.category_name, "");
    if (!categoryName) continue;
    const subcategories = [];
    for (const subcategory of Array.isArray(category?.subcategories)
      ? category.subcategories
      : []) {
      const subcategoryName = sanitizeFileName(subcategory?.subcategory_name, "");
      if (!subcategoryName) continue;
      subcategories.push({
        subcategory_name: subcategoryName,
        patterns: dedupeTextList(subcategory?.patterns),
        methodologies: dedupeTextList(subcategory?.methodologies),
      });
    }
    if (!subcategories.length) continue;
    categories.push({
      category_name: categoryName,
      subcategories,
    });
  }
  return { domain_name: domainName, categories };
}

