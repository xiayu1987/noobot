/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { migrateSessionDocument } from "../src/index.js";
import { releasedSession } from "./helpers/released-session.js";

for (const value of [null, "legacy", { retired: true }]) {
  test(`offline migration removes retired projections with ${JSON.stringify(value)} values once`, () => {
    const canonical = releasedSession({
      schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
      sessionId: "session-1",
      aggregateVersion: 0,
      caller: SESSION_CALLER.USER,
    });
    const source = {
      ...canonical,
      sessionArtifacts: value,
      turnTerminalCommits: value,
      shortMemoryCheckpoint: value,
    };
    const before = structuredClone(source);
    const migrated = migrateSessionDocument(source);
    assert.deepEqual(source, before);
    assert.deepEqual(migrated.document, canonical);
    assert.equal(migrated.changed, true);
    assert.deepEqual(migrated.migrations, ["retired-session-projections-v1"]);
    const repeated = migrateSessionDocument(migrated.document);
    assert.deepEqual(repeated.document, canonical);
    assert.equal(repeated.changed, false);
    assert.deepEqual(repeated.migrations, []);
  });
}
