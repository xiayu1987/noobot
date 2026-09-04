/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Single normalization contract for the protocol's string-list fields: trim,
 * drop empties, and optionally collapse duplicates. Policy, projection and
 * contract modules read list-shaped config through this function so the rule
 * is stated exactly once.
 */
export function normalizeStringList(input = [], { dedupe = false } = {}) {
  const values = (Array.isArray(input) ? input : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return dedupe ? Array.from(new Set(values)) : values;
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
