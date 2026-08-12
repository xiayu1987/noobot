/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeCachePolicy(input = {}) {
  return Object.freeze({
    flow: String(input.flow || "").trim(),
    key: String(input.key || "").trim(),
    retention: String(input.retention || "").trim(),
    options: Object.freeze({ ...input.options }),
  });
}
