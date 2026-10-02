/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../text.js";
import { collectPatchItemsByFieldMap, groupItemsByCategoryFields } from "./patch-items.js";
import { EXPERIENCE_PATCH_SCHEMA } from "./schema.js";

function collectSchemaItems(schemaKey, { rawContent, stage, onParseError }) {
  const schema = EXPERIENCE_PATCH_SCHEMA[schemaKey];
  if (!schema) throw new Error(`unknown experience patch schema: ${schemaKey}`);
  const items = collectPatchItemsByFieldMap({
    rawContent,
    idPrefix: schema.idPrefix,
    stage,
    parseErrorCode: schema.parseErrorCode,
    onParseError,
    fieldMap: schema.fieldMap,
    requiredFields: schema.requiredFields,
  });
  return { schema, items };
}

export function parseDailyExperienceOutput(rawContent, { onParseError = null } = {}) {
  const { items } = collectSchemaItems("daily", {
    rawContent,
    stage: "daily_experience",
    onParseError,
  });
  const out = [];
  for (const item of items) {
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

export function normalizeDomainSummaryOutput({
  schemaKey = "",
  rawContent = "",
  fallbackDomainName = "",
  onParseError = null,
} = {}) {
  const { schema, items } = collectSchemaItems(schemaKey, {
    rawContent,
    stage: `${schemaKey}_summary:${fallbackDomainName}`,
    onParseError,
  });
  return {
    domain_name: sanitizeFileName(fallbackDomainName, fallbackDomainName),
    categories: schema.subFields ? groupItemsByCategoryFields(items, schema.subFields) : items,
  };
}
