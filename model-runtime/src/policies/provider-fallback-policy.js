/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function resolveFallbackCandidate(policy = {}, attempted = []) {
  if (policy.enabled !== true) return null;
  const used = new Set(attempted);
  return (policy.candidates || []).find((item) => !used.has(item)) || null;
}
