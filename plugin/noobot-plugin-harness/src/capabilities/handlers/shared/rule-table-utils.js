/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isFunction } from "@noobot/shared/value";

export function resolveFirstMatchedRuleResult(rules = [], context = {}, fallbackResult = null) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!isFunction(rule?.matches) || !isFunction(rule?.resolve)) {
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
    if (!isFunction(rule?.when)) continue;
    if (rule.when(context) !== true) continue;
    codes.push(text(rule?.code));
  }
  return codes.filter(Boolean);
}
