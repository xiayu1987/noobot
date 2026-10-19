/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { migrateSessionDocument } from "../src/index.js";
import { SESSION_CALLER_MIGRATION } from "../src/session-caller-migration.js";

function currentDocument(fields) {
  return {
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    sessionId: "session-1",
    aggregateVersion: 0,
    messages: [],
    dialogOrder: [],
    ...fields,
  };
}

test("caller outside the protocol enum is repaired to the explicit user caller", () => {
  for (const fields of [{}, { caller: "" }, { caller: "admin" }, { caller: null }]) {
    const result = migrateSessionDocument(currentDocument(fields));
    assert.equal(result.document.caller, SESSION_CALLER.USER);
    assert.equal(result.changed, true);
    assert.ok(result.migrations.includes(SESSION_CALLER_MIGRATION));
  }
});

test("protocol caller is kept as persisted", () => {
  for (const caller of Object.values(SESSION_CALLER)) {
    const result = migrateSessionDocument(currentDocument({ caller }));
    assert.equal(result.document.caller, caller);
    assert.equal(result.changed, false);
    assert.deepEqual(result.migrations, []);
  }
});
