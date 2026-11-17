/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";

export function createScopedSessionMetadataRecord(value) {
  if (value !== null && !isPlainObject(value))
    throw new TypeError("Scoped session metadata must be a plain object or null");
  return { version: 1, value };
}

export function readScopedSessionMetadataRecord(record) {
  if (
    !isPlainObject(record) ||
    record.version !== 1 ||
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, "value")
  )
    throw new TypeError("Invalid scoped session metadata record; offline upgrade required");
  return createScopedSessionMetadataRecord(record.value).value;
}
