/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeFileName } from "../utils/text.js";
import { collectPatchItemsByFieldMap, groupItemsByCategoryFields } from "./patch-utils.js";
import { EXPERIENCE_PATCH_SCHEMA } from "./schema-config.js";

export function normalizeDomainSummaryOutput({
  schemaKey = "",
  rawContent = "",
  fallbackDomainName = "",
  onParseError = null,
} = {}) {
  const schema = EXPERIENCE_PATCH_SCHEMA[schemaKey];
  if (!schema) {
    throw new Error(`unknown experience patch schema: ${schemaKey}`);
  }
  const items = collectPatchItemsByFieldMap({
    rawContent,
    idPrefix: schema.idPrefix,
    stage: `${schemaKey}_summary:${fallbackDomainName}`,
    parseErrorCode: schema.parseErrorCode,
    onParseError,
    fieldMap: schema.fieldMap,
    requiredFields: schema.requiredFields,
  });
  return {
    domain_name: sanitizeFileName(fallbackDomainName, fallbackDomainName),
    categories: schema.subFields ? groupItemsByCategoryFields(items, schema.subFields) : items,
  };
}
