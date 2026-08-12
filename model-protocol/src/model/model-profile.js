/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createModelProfile(input = {}) {
  const id = String(input.id || "").trim();
  if (!id) throw new TypeError("model profile.id is required");
  return Object.freeze({ ...input, id });
}
