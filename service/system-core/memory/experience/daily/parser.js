/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseJsonWithLogging } from "../../parsers/json-parser.js";
import { sanitizeFileName, dedupeTextList } from "../../utils/text.js";

export function normalizeDailyDomainResultItems(rawItems = []) {
  const out = [];
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    const domainName = sanitizeFileName(item?.domain_name, "");
    if (!domainName) continue;
    out.push({
      domain_name: domainName,
      is_new_domain: Boolean(item?.is_new_domain),
      experiences: dedupeTextList(item?.experiences),
      lessons: dedupeTextList(item?.lessons),
    });
  }
  return out;
}

export function parseDailyExperienceOutput(rawContent, { onParseError = null } = {}) {
  const { parsed } = parseJsonWithLogging({
    rawContent,
    stage: "daily_experience",
    defaultValue: {},
    onError: onParseError,
  });
  const items = Array.isArray(parsed?.results) ? parsed.results : [];
  return normalizeDailyDomainResultItems(items);
}

