/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { migrateSessionDocument } from "../src/index.js";
import { SESSION_REPAIR_ERROR_CODE } from "../src/errors.js";
import { releasedSession } from "./helpers/released-session.js";

function document(schemaVersion) {
  return releasedSession({
    schemaVersion,
    sessionId: "s-1",
    caller: "user",
    aggregateVersion: 0,
    dialogOrder: [],
  });
}
const INVALID = { code: SESSION_REPAIR_ERROR_CODE.ARTIFACT_FIELD_SCHEMA_MISMATCH };

test("schema19 missing artifact collection migrates explicitly and is idempotent", () => {
  const source = document(19);
  delete source.sessionArtifactEvents;
  const result = migrateSessionDocument(source);
  assert.equal(result.document.schemaVersion, 21);
  assert.deepEqual(result.document.sessionArtifactEvents, []);
  assert.ok(result.migrations.includes("session-artifact-events-v20"));
  assert.equal(Object.hasOwn(source, "sessionArtifactEvents"), false);
  assert.equal(migrateSessionDocument(result.document).changed, false);
});

test("schema20 missing collection is rejected rather than materialized", () => {
  const source = document(20);
  delete source.sessionArtifactEvents;
  assert.throws(() => migrateSessionDocument(source), INVALID);
  assert.equal(Object.hasOwn(source, "sessionArtifactEvents"), false);
});

test("legacy and current corrupt collections are rejected without filtering", () => {
  for (const schemaVersion of [19, 20]) {
    for (const sessionArtifactEvents of [
      undefined,
      null,
      {},
      [null],
      [{ identity: { eventId: "e-1", sessionId: "other" } }],
    ]) {
      const source = { ...document(schemaVersion), sessionArtifactEvents };
      const before = structuredClone(source);
      assert.throws(() => migrateSessionDocument(source), INVALID);
      assert.deepEqual(source, before);
    }
  }
});
