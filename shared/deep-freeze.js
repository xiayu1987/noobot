/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isObjectLike } from "./value.js";
export function deepFreeze(value, seen = new WeakSet()) {
  if (!isObjectLike(value) || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return value;
}
