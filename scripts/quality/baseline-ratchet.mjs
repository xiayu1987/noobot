/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function compareRatchet(label, actual, allowed) {
  if (actual > allowed) return { increase: `${label}: ${actual} exceeds baseline ${allowed}` };
  if (actual < allowed) return { decrease: `${label}: ${actual} below baseline ${allowed}` };
  return {};
}

export function collectRatchet(entries) {
  const increases = [];
  const decreases = [];
  for (const [label, actual, allowed] of entries) {
    const { increase, decrease } = compareRatchet(label, actual, allowed);
    if (increase) increases.push(increase);
    if (decrease) decreases.push(decrease);
  }
  return { increases, decreases };
}

export function ratchetViolations({ increases, decreases }, staleHint) {
  return [...increases, ...decreases.map((line) => `stale baseline, ${staleHint}: ${line}`)];
}
