/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeFileName } from "../../utils/text.js";
import { collectPatchItemsByFieldMap } from "../patch-utils.js";
import { EXPERIENCE_PATCH_SCHEMA } from "../schema-config.js";

export function normalizeWeeklySummaryOutput(
  rawContent,
  fallbackDomainName = "",
  { onParseError = null } = {},
) {
  const schema = EXPERIENCE_PATCH_SCHEMA.weekly;
  const stage = `weekly_summary:${fallbackDomainName}`;
  const categories = collectPatchItemsByFieldMap({
    rawContent,
    idPrefix: schema.idPrefix,
    stage,
    parseErrorCode: schema.parseErrorCode,
    onParseError,
    fieldMap: schema.fieldMap,
    requiredFields: schema.requiredFields,
  });
  const domainName = sanitizeFileName(fallbackDomainName, fallbackDomainName);
  return { domain_name: domainName, categories };
}
