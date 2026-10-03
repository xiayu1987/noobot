/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function buildSubcategoryModelEntries(parsedSummary = {}, fallbackDomainName = "") {
  const domainName = parsedSummary?.domain || fallbackDomainName;
  const entries = [];
  for (const category of Array.isArray(parsedSummary?.categories) ? parsedSummary.categories : []) {
    for (const subcategory of Array.isArray(category?.subcategories)
      ? category.subcategories
      : []) {
      entries.push({
        domain: domainName,
        category: category?.category,
        subcategory: subcategory?.subcategory,
      });
    }
  }
  return entries;
}
