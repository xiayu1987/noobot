/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createWeakArrayIndex({ keyOf } = {}) {
  if (typeof keyOf !== "function") {
    throw new TypeError("createWeakArrayIndex requires keyOf");
  }
  const indexes = new WeakMap();

  function indexFor(values = []) {
    if (!Array.isArray(values)) throw new TypeError("timeline index requires an array");
    let index = indexes.get(values);
    if (index) return index;
    index = new Map();
    values.forEach((value, position) => {
      const key = keyOf(value);
      if (key) index.set(key, position);
    });
    indexes.set(values, index);
    return index;
  }

  function recordInsertion(values = [], start = 0) {
    const index = indexFor(values);
    for (let position = Math.max(0, Number(start) || 0); position < values.length; position += 1) {
      const key = keyOf(values[position]);
      if (key) index.set(key, position);
    }
    return index;
  }

  return Object.freeze({ indexFor, recordInsertion });
}

