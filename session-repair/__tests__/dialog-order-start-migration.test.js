/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ARTIFACT_DIALOG_ORDER_START_SCHEMA_VERSION,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { releasedSession } from "./helpers/released-session.js";

const MIGRATION = "session-dialog-order-start-v22";
const ANCHOR_TS = "2026-10-01T00:00:00.000Z";

function sessionWith(dialogOrder, schemaVersion) {
  return releasedSession({
    schemaVersion,
    sessionId: "session-1",
    aggregateVersion: 0,
    dialogOrder,
  });
}

const entry = {
  dialogProcessId: "dialog-1",
  turnScopeId: "",
  userMessageUid: "",
  dialogOrdinal: 1,
};

test("v22 migration strips dialogOrder startedAt duplicated from anchor message ts", () => {
  const source = sessionWith([{ ...entry, startedAt: ANCHOR_TS }], 21);
  const result = migrateSessionDocument(source);
  assert.ok(result.migrations.includes(MIGRATION));
  assert.equal(Object.hasOwn(result.document.dialogOrder[0], "startedAt"), false);
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
});

test("v22 migration does not record itself when no entry carries startedAt", () => {
  const result = migrateSessionDocument(sessionWith([{ ...entry }], 21));
  assert.equal(result.migrations.includes(MIGRATION), false);
});

test("v22 documents are not re-migrated for dialogOrder startedAt", () => {
  const result = migrateSessionDocument(
    sessionWith([{ ...entry }], SESSION_ARTIFACT_DIALOG_ORDER_START_SCHEMA_VERSION),
  );
  assert.equal(result.migrations.includes(MIGRATION), false);
});
