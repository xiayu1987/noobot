/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMUTABLE_CLEANUP_CAPACITY as CAPACITY,
  requireImmutableCleanupCapacity,
} from "../src/immutable-cleanup-capacity.js";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  requireImmutableCleanupRequest,
  requireImmutableCleanupFilterBudget,
} from "../src/immutable-storage.js";
import { IMMUTABLE_CLEANUP_FILTER as FILTER } from "../src/immutable-cleanup-filter.js";

test("capacity accepts explicit empty and full reservations", () => {
  for (const record of [
    { format: CAPACITY.format, pages: 0, reserved: null },
    { format: CAPACITY.format, pages: PLAN.chunkPages, reserved: "a".repeat(64) },
  ])
    assert.equal(requireImmutableCleanupCapacity(record), record);
});

test("capacity rejects malformed, inconsistent and oversized reservations", () => {
  const record = { format: CAPACITY.format, pages: 1, reserved: "a".repeat(64) };
  for (const invalid of [
    null,
    {},
    { ...record, format: "unknown" },
    { ...record, pages: -1 },
    { ...record, pages: PLAN.chunkPages + 1 },
    { ...record, pages: 1.5 },
    { ...record, pages: 0 },
    { ...record, reserved: null },
    { ...record, reserved: "../foreign" },
    { ...record, extra: true },
  ])
    assert.throws(() => requireImmutableCleanupCapacity(invalid), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});

test("prepare request and filtering share the same budget validation", () => {
  for (const value of [0, -1, 1.5, "1", null, FILTER.maxEntries + 1]) {
    assert.throws(() => requireImmutableCleanupFilterBudget(value), TypeError);
    assert.throws(
      () =>
        requireImmutableCleanupRequest("prepare", {
          dryRun: false,
          maxFilterEntries: value,
        }),
      TypeError,
    );
  }
  for (const maxFilterEntries of [1, FILTER.maxEntries]) {
    const request = { dryRun: false, maxFilterEntries };
    assert.equal(requireImmutableCleanupRequest("prepare", request), request);
  }
});
