/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWorkspaceMigrationQuarantineRecord,
  classifyHistoricalMigrationQuarantine,
} from "../src/migration-quarantine.js";
import { WORKSPACE_LAYOUT_UPGRADE_OWNER as OWNER } from "../src/layout-migration.js";

function receipt() {
  return {
    kind: OWNER.SESSION_MESSAGE_IDENTITY,
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

test("only declared historical session owners receive session failure classifications", () => {
  const original = receipt();
  const classified = classifyHistoricalMigrationQuarantine(original);
  assert.deepEqual(classified.sessionStorage, {
    format: "unverified",
    status: "historical-upgrade-failed",
  });
  assert.equal(classified.error, original.error);
  assert.equal(Object.hasOwn(original, "sessionStorage"), false);
  assert.equal(classifyHistoricalMigrationQuarantine(classified), classified);
  for (const kind of [
    OWNER.ATTACHMENT_CATALOG,
    OWNER.DIRECTORY_LOCK_RETIREMENT,
    "session-unknown",
    "unknown",
  ]) {
    const other = { ...original, kind };
    assert.equal(classifyHistoricalMigrationQuarantine(other), other);
    assert.equal(Object.hasOwn(other, "sessionStorage"), false);
  }
});
