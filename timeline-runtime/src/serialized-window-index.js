/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createSerializedWindowIndex({ field, limit } = {}) {
  const fieldName = String(field || "").trim();
  const maximum = Math.max(1, Number(limit) || 0);
  if (!fieldName) throw new TypeError("createSerializedWindowIndex requires field");
  const indexes = new WeakMap();

  function valuesOf(owner = {}) {
    if (!Array.isArray(owner[fieldName])) owner[fieldName] = [];
    return owner[fieldName];
  }

  function indexOf(owner = {}) {
    const values = valuesOf(owner);
    const cached = indexes.get(owner);
    if (cached?.values === values && cached.size === values.length) return cached.index;
    const index = new Set(values);
    indexes.set(owner, { values, size: values.length, index });
    return index;
  }

  function has(owner = {}, value) {
    return indexOf(owner).has(value);
  }

  function append(owner = {}, value) {
    const values = valuesOf(owner);
    const index = indexOf(owner);
    if (index.has(value)) return false;
    values.push(value);
    index.add(value);
    if (values.length > maximum) {
      const removed = values.shift();
      index.delete(removed);
    }
    indexes.set(owner, { values, size: values.length, index });
    return true;
  }

  return Object.freeze({ append, has });
}

