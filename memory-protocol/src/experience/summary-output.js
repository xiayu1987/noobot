/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeTextList, sanitizeFileName } from "../text.js";
import { collectPatchItemsByFieldMap, groupItemsByCategoryFields } from "./patch-items.js";
import { BUILTIN_EXPERIENCE_FIELDS } from "./fields.js";
import { buildExperiencePatchSchema } from "./schema.js";

function collectSchemaItems(schemaKey, { rawContent, stage, onParseError, fields }) {
  const schema = buildExperiencePatchSchema(schemaKey, fields);
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

export function parseDailyExperienceOutput(
  rawContent,
  { onParseError = null, fields = BUILTIN_EXPERIENCE_FIELDS } = {},
) {
  const { schema, items } = collectSchemaItems("daily", {
    rawContent,
    stage: "daily_experience",
    onParseError,
    fields,
  });
  const out = [];
  for (const item of items) {
    const domainName = sanitizeFileName(item?.domain, "");
    if (!domainName) continue;
    const entry = { domain: domainName, new: Boolean(item?.new) };
    for (const { key } of schema.contentFields) entry[key] = dedupeTextList(item?.[key]);
    out.push(entry);
  }
  return out;
}

export function normalizeDomainSummaryOutput({
  schemaKey = "",
  rawContent = "",
  fallbackDomainName = "",
  onParseError = null,
  fields = BUILTIN_EXPERIENCE_FIELDS,
} = {}) {
  const { schema, items } = collectSchemaItems(schemaKey, {
    rawContent,
    stage: `${schemaKey}_summary:${fallbackDomainName}`,
    onParseError,
    fields,
  });
  return {
    domain: sanitizeFileName(fallbackDomainName, fallbackDomainName),
    categories: schema.subFields ? groupItemsByCategoryFields(items, schema.subFields) : items,
  };
}
