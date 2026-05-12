/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Model spec comparison utility.
 */

/**
 * Compare two model specs for equality (semantic comparison).
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function isSameModelSpec(a = {}, b = {}) {
  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
    "alias",
    "model",
    "temperature",
    "maxTokens",
    "topP",
    "frequencyPenalty",
    "presencePenalty",
    "providerFormat",
  ]);

  for (const key of keys) {
    const va = a[key];
    const vb = b[key];
    if (va === undefined && vb === undefined) continue;
    if (va !== vb) return false;
  }
  return true;
}
