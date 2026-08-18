/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function upsertOrderedFact({
  values = [],
  fact,
  key,
  index,
  compare,
  merge = (_previous, incoming) => incoming,
  recordInsertion,
} = {}) {
  if (!Array.isArray(values)) throw new TypeError("upsertOrderedFact requires values array");
  if (!(index instanceof Map)) throw new TypeError("upsertOrderedFact requires index map");
  if (typeof compare !== "function") throw new TypeError("upsertOrderedFact requires compare");
  const existingPosition = index.get(key);
  if (Number.isInteger(existingPosition)) {
    values[existingPosition] = merge(values[existingPosition], fact);
    return values;
  }

  const previous = values.at(-1);
  if (!previous || compare(previous, fact) <= 0) {
    values.push(fact);
    index.set(key, values.length - 1);
    return values;
  }

  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(values[middle], fact) <= 0) low = middle + 1;
    else high = middle;
  }
  values.splice(low, 0, fact);
  if (typeof recordInsertion !== "function") {
    throw new TypeError("ordered insertion requires recordInsertion");
  }
  recordInsertion(values, low);
  return values;
}

export function selectLatestOrderedFacts(
  facts = [],
  { limit = 0, compare, project = (fact) => fact } = {},
) {
  if (!Array.isArray(facts)) return [];
  if (typeof compare !== "function") throw new TypeError("selectLatestOrderedFacts requires compare");
  if (typeof project !== "function") throw new TypeError("selectLatestOrderedFacts requires project");
  const maximum = Math.max(0, Number(limit) || 0);
  if (!maximum) return [];
  const latest = [];
  for (const fact of facts) {
    if (latest.length === maximum && compare(fact, latest[0]) < 0) continue;
    let low = 0;
    let high = latest.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(latest[middle], fact) <= 0) low = middle + 1;
      else high = middle;
    }
    latest.splice(low, 0, fact);
    if (latest.length > maximum) latest.shift();
  }
  return latest.map(project);
}
