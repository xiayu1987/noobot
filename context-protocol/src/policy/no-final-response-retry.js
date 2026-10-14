/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const NO_FINAL_RESPONSE_RETRY_POLICY = Object.freeze({
  IN_PLACE_RETRY_ATTEMPTS: 1,
  MAX_CONSECUTIVE_PROMPTS: 3,
});

function normalizeCount(value = 0) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function resolveNextNoFinalResponseRetryOrdinal(issuedCount = 0) {
  return normalizeCount(issuedCount) + 1;
}

export function hasNoFinalResponseRetryBudget(
  consecutiveCount = 0,
  { maxConsecutivePrompts = NO_FINAL_RESPONSE_RETRY_POLICY.MAX_CONSECUTIVE_PROMPTS } = {},
) {
  return normalizeCount(consecutiveCount) < normalizeCount(maxConsecutivePrompts);
}
