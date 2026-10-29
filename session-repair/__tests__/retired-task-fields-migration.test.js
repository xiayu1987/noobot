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

const MIGRATION = "retired-task-fields-v18";

function message(messageUid, extra = {}) {
  return {
    messageUid,
    sessionId: "session-1",
    dialogProcessId: `dialog-${messageUid}`,
    turnScopeId: `turn-${messageUid}`,
    role: "user",
    type: "message",
    content: "hi",
    attachments: [],
    messageOrigin: "natural",
    ts: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function sessionWith(messages, extra = {}) {
  return releasedSession({
    schemaVersion: 17,
    sessionId: "session-1",
    aggregateVersion: 1,
    messages,
    ...extra,
  });
}

test("v18 drops retired task fields from the session and its messages", () => {
  const result = migrateSessionDocument(
    sessionWith([message("u1", { taskId: "", taskStatus: "" }), message("u2")], {
      currentTaskId: "",
    }),
  );
  assert.ok(result.migrations.includes(MIGRATION));
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(result.document, "currentTaskId"), false);
  for (const item of result.document.messages) {
    assert.equal(Object.hasOwn(item, "taskId"), false);
    assert.equal(Object.hasOwn(item, "taskStatus"), false);
  }
});

test("v18 documents are not re-migrated", () => {
  const result = migrateSessionDocument(
    sessionWith([message("u1")], { schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION }),
  );
  assert.equal(result.migrations.includes(MIGRATION), false);
});
