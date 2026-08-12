/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeProtocolToolCall(input = {}) {
  return Object.freeze({
    id: String(input.id || "").trim(),
    name: String(input.name || "").trim(),
    args: input.args && typeof input.args === "object" ? input.args : {},
  });
}
