/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveErrorHeaderValue(headers = null, name = "") {
  if (!headers || !name) return undefined;
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return undefined;
  if (typeof headers?.get === "function") {
    return headers.get(normalizedName) || headers.get(normalizedName.toLowerCase()) || undefined;
  }
  return headers?.[normalizedName] ?? headers?.[normalizedName.toLowerCase()] ?? undefined;
}
