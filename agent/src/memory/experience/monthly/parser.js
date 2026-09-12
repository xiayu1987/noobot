/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeDomainSummaryOutput } from "../domain-summary-parser.js";

export function normalizeMonthlySummaryOutput(
  rawContent,
  fallbackDomainName = "",
  { onParseError = null } = {},
) {
  return normalizeDomainSummaryOutput({
    schemaKey: "monthly",
    rawContent,
    fallbackDomainName,
    onParseError,
  });
}
