/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeStreamingPolicy(input = {}) {
  return Object.freeze({
    enabled: input.enabled === true,
    disableAfterToolCallMismatches: Math.max(1, Number(input.disableAfterToolCallMismatches) || 2),
  });
}
