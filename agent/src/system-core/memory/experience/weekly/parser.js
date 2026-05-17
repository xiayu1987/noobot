/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseJsonWithLogging } from "../../parsers/json-parser.js";
import { sanitizeFileName, dedupeTextList } from "../../utils/text.js";

export function normalizeWeeklySummaryOutput(
  rawContent,
  fallbackDomainName = "",
  { onParseError = null } = {},
) {
  const { parsed } = parseJsonWithLogging({
    rawContent,
    stage: `weekly_summary:${fallbackDomainName}`,
    defaultValue: {},
    onError: onParseError,
  });
  const domainName = sanitizeFileName(
    parsed?.domain_name || fallbackDomainName,
    fallbackDomainName,
  );
  const categories = [];
  for (const item of Array.isArray(parsed?.categories) ? parsed.categories : []) {
    const categoryName = sanitizeFileName(item?.category_name, "");
    if (!categoryName) continue;
    categories.push({
      category_name: categoryName,
      experiences: dedupeTextList(item?.experiences),
      lessons: dedupeTextList(item?.lessons),
    });
  }
  return { domain_name: domainName, categories };
}

