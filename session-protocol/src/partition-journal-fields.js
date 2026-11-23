/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PARTITION_JOURNAL_HEAD_FILE = "CURRENT";

export function exactObject(value, keys, label) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new TypeError(`Invalid ${label} fields`);
}

export function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid ${label}`);
}
