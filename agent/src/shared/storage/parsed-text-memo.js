/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { isFunction } from "@noobot/shared/value";

export function createParsedTextMemo(parse) {
  if (!isFunction(parse)) throw new TypeError("parsed text memo requires parse(raw, file)");
  const entries = new Map();
  return function parseMemoized(raw, file) {
    const cached = entries.get(file);
    if (cached && cached.raw === raw) return cached.value;
    const value = deepFreeze(parse(raw, file));
    entries.set(file, { raw, value });
    return value;
  };
}
