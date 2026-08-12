/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeTimeoutPolicy(input = {}) {
  const timeoutMs = Number(input.timeoutMs || 0);
  return Object.freeze({
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 0,
  });
}
