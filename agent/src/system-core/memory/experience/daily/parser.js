/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeFileName, dedupeTextList } from "../../utils/text.js";
import { collectPatchItemsByFieldMap } from "../patch-utils.js";
import { EXPERIENCE_PATCH_SCHEMA } from "../schema-config.js";

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
  const schema = EXPERIENCE_PATCH_SCHEMA.daily;
  const items = collectPatchItemsByFieldMap({
    rawContent,
    idPrefix: schema.idPrefix,
    stage: "daily_experience",
    parseErrorCode: schema.parseErrorCode,
    onParseError,
    fieldMap: schema.fieldMap,
    requiredFields: schema.requiredFields,
  });
  return normalizeDailyDomainResultItems(items);
}
