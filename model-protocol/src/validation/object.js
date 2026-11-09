/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

export function requirePlainObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

export function rejectUnknownKeys(value, allowedKeys, path) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new TypeError(`${path} contains unsupported fields: ${unknown.join(", ")}`);
}
