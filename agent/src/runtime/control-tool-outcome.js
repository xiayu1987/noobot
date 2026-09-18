/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveControlToolOutcome(toolCallResults = [], toolName = "") {
  const expectedName = String(toolName || "").trim();
  const attempts = (Array.isArray(toolCallResults) ? toolCallResults : []).filter(
    (result) => String(result?.call?.name || "").trim() === expectedName,
  );
  return Object.freeze({
    attempted: attempts.length > 0,
    accepted: attempts.some((result) => result?.success === true),
  });
}
