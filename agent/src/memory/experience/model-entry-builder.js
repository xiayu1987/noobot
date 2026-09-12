/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function buildSubcategoryModelEntries(parsedSummary = {}, fallbackDomainName = "") {
  const domainName = parsedSummary?.domain_name || fallbackDomainName;
  const entries = [];
  for (const category of Array.isArray(parsedSummary?.categories) ? parsedSummary.categories : []) {
    for (const subcategory of Array.isArray(category?.subcategories)
      ? category.subcategories
      : []) {
      entries.push({
        domain_name: domainName,
        category_name: category?.category_name,
        subcategory_name: subcategory?.subcategory_name,
      });
    }
  }
  return entries;
}
