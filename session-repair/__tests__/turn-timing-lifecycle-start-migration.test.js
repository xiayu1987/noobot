/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { releasedSession } from "./helpers/released-session.js";

const MIGRATION = "turn-timing-lifecycle-start-v16";
const STARTED_AT = "2026-10-01T00:00:00.000Z";
const FINISHED_AT = "2026-10-01T00:00:09.000Z";

function sessionWith(timing, startedAt, schemaVersion) {
  return releasedSession({
    schemaVersion,
    sessionId: "session-1",
    aggregateVersion: 0,
    turnTimings: [timing],
    turnLifecycle: { turns: { "turn-1": { turnScopeId: "turn-1", startedAt } } },
  });
}

const timing = {
  turnScopeId: "turn-1",
  dialogProcessId: "dialog-1",
  thinkingStartedAt: STARTED_AT,
  thinkingFinishedAt: FINISHED_AT,
};

test("v16 migration drops turn timing start that duplicates lifecycle startedAt", () => {
  const result = migrateSessionDocument(sessionWith({ ...timing }, STARTED_AT, 15));
  assert.ok(result.migrations.includes(MIGRATION));
  assert.deepEqual(result.document.turnTimings, [
    { turnScopeId: "turn-1", dialogProcessId: "dialog-1", thinkingFinishedAt: FINISHED_AT },
  ]);
  assert.equal(result.document.turnLifecycle.turns["turn-1"].startedAt, STARTED_AT);
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
});

test("v16 migration rejects turn timing start that conflicts with lifecycle startedAt", () => {
  assert.throws(
    () => migrateSessionDocument(sessionWith({ ...timing }, "2026-10-01T00:00:01.000Z", 15)),
    { code: "SESSION_TURN_TIMING_START_CONFLICT" },
  );
});

test("v16 documents are not re-migrated for turn timing start", () => {
  const result = migrateSessionDocument(
    sessionWith({ ...timing }, STARTED_AT, SESSION_ARTIFACT_SCHEMA_VERSION),
  );
  assert.equal(result.migrations.includes(MIGRATION), false);
});

test("v16 migration drops timing shells left without any timing fact", () => {
  const startOnly = {
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    thinkingStartedAt: STARTED_AT,
  };
  const result = migrateSessionDocument(sessionWith(startOnly, STARTED_AT, 15));
  assert.ok(result.migrations.includes(MIGRATION));
  assert.deepEqual(result.document.turnTimings, []);
});
