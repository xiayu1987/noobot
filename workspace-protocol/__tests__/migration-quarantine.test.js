/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkspaceMigrationQuarantineRecord } from "../src/migration-quarantine.js";

function receipt() {
  return {
    kind: "sessionMessageIdentity",
    path: "runtime/session/s1",
    moved: false,
    quarantinedAt: "2026-11-22T00:00:00.000Z",
    error: { code: "MIGRATION_UNMAPPABLE", message: "Missing identity" },
  };
}

test("quarantine receipts distinguish in-place rejection, held source and restored source", () => {
  const original = receipt();
  for (const record of [
    original,
    { ...original, moved: true, moveIdentity: "12:34" },
    { ...original, restored: true },
    { ...original, moved: true, moveIdentity: "12:34", restored: true },
  ]) {
    const before = structuredClone(record);
    assert.equal(assertWorkspaceMigrationQuarantineRecord(record), record);
    assert.deepEqual(record, before);
  }
});

test("quarantine receipts reject unknown states and missing ownership evidence", () => {
  for (const invalid of [
    null,
    {},
    { ...receipt(), moved: undefined },
    { ...receipt(), moved: "false" },
    { ...receipt(), moved: true },
    { ...receipt(), moved: true, moveIdentity: "" },
    { ...receipt(), moved: true, moveIdentity: "unverified" },
    { ...receipt(), moveIdentity: "12:34" },
    { ...receipt(), restored: false },
    { ...receipt(), restored: "true" },
    { ...receipt(), quarantinedAt: "unknown" },
    { ...receipt(), error: {} },
    { ...receipt(), fallbackIdentity: "12:34" },
  ])
    assert.throws(() => assertWorkspaceMigrationQuarantineRecord(invalid), TypeError);
});
