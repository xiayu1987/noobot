/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isObjectLike } from "./value.js";

const deepFrozenRoots = new WeakSet();

export function isDeepFrozen(value) {
  return deepFrozenRoots.has(value);
}

function freezeNested(value, seen) {
  if (!isObjectLike(value) || deepFrozenRoots.has(value) || seen.has(value)) return;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeNested(nested, seen);
}

export function deepFreeze(value) {
  if (!isObjectLike(value) || deepFrozenRoots.has(value)) return value;
  freezeNested(value, new Set());
  deepFrozenRoots.add(value);
  return value;
}
