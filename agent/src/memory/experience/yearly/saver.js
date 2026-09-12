/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { saveSubcategoryDomainSummary } from "../subcategory-summary-saver.js";

export async function saveYearlyDomainSummary({
  storage,
  basePath = "",
  yearKey = "",
  domainName = "",
  categories = [],
  createdAt = "",
  sourceMonths = [],
} = {}) {
  return saveSubcategoryDomainSummary({
    schemaKey: "yearly",
    storage,
    basePath,
    periodKey: yearKey,
    periodDir: storage.yearlySummaryDir(basePath),
    domainName,
    categories,
    createdAt,
    sourceKeys: sourceMonths,
  });
}
