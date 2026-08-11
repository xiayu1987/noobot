/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeToolPolicy(input = {}) {
  return Object.freeze({ choice: input.choice ?? "auto", parallel: input.parallel !== false });
}
