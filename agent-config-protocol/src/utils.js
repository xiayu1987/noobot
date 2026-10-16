/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

export { isPlainObject };

export function normalizeStringList(input = [], { dedupe = false } = {}) {
  const values = (Array.isArray(input) ? input : []).map((item) => text(item)).filter(Boolean);
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
