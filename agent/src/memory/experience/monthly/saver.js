/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { saveSubcategoryDomainSummary } from "../subcategory-summary-saver.js";

export async function saveMonthlyDomainSummary({
  storage,
  basePath = "",
  monthKey = "",
  domainName = "",
  categories = [],
  createdAt = "",
  sourceWeeks = [],
} = {}) {
  return saveSubcategoryDomainSummary({
    schemaKey: "monthly",
    storage,
    basePath,
    periodKey: monthKey,
    periodDir: storage.monthlySummaryDir(basePath),
    domainName,
    categories,
    createdAt,
    sourceKeys: sourceWeeks,
  });
}
