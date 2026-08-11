/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeFallbackPolicy(input = {}) {
  return Object.freeze({
    enabled: input.enabled === true,
    candidates: Object.freeze(Array.isArray(input.candidates) ? [...input.candidates] : []),
  });
}
