/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveFirstMatchedRuleResult(
  rules = [],
  context = {},
  fallbackResult = null,
) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (typeof rule?.matches !== "function" || typeof rule?.resolve !== "function") {
      continue;
    }
    if (rule.matches(context) !== true) continue;
    return rule.resolve(context);
  }
  return fallbackResult;
}

export function collectRuleCodes(rules = [], context = {}) {
  const codes = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (typeof rule?.when !== "function") continue;
    if (rule.when(context) !== true) continue;
    codes.push(String(rule?.code || "").trim());
  }
  return codes.filter(Boolean);
}
