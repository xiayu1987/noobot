/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
export function deepMerge(base, override) {
  const left = isPlainObject(base) ? base : {};
  const right = isPlainObject(override) ? override : {};
  const out = { ...left };
  for (const [key, value] of Object.entries(right)) {
    out[key] =
      isPlainObject(value) && isPlainObject(left[key]) ? deepMerge(left[key], value) : value;
  }
  return out;
}
