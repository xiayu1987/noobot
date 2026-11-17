/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  immutableStorageError,
  requireObjectReference,
} from "./immutable-storage.js";

export const IMMUTABLE_CLEANUP_CAPACITY = Object.freeze({
  format: "noobot.cleanup-capacity/1",
  file: "capacity.json",
});

export function requireImmutableCleanupCapacity(record) {
  if (
    !isPlainObject(record) ||
    Object.keys(record).length !== 3 ||
    record.format !== IMMUTABLE_CLEANUP_CAPACITY.format ||
    !Number.isSafeInteger(record.pages) ||
    record.pages < 0 ||
    record.pages > PLAN.chunkPages ||
    (record.reserved === null) !== (record.pages === 0)
  )
    throw immutableStorageError("Invalid cleanup capacity reservation");
  if (record.reserved !== null) requireObjectReference(record.reserved);
  return record;
}
