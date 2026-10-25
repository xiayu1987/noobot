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

function message(messageUid, extra) {
  return {
    messageUid,
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    role: "user",
    type: "message",
    content: "hi",
    ...extra,
  };
}

function sessionWith(messages, schemaVersion) {
  return releasedSession({
    schemaVersion,
    sessionId: "session-1",
    aggregateVersion: 0,
    messages,
  });
}

test("v15 migration drops non-text message error flags and keeps error text", () => {
  const result = migrateSessionDocument(
    sessionWith(
      [
        message("sm_flag", { error: false }),
        message("sm_text", { error: "model timeout" }),
        message("sm_none", {}),
      ],
      14,
    ),
  );
  const byUid = new Map(result.document.messages.map((item) => [item.messageUid, item]));
  assert.ok(result.migrations.includes("message-error-text-v15"));
  assert.equal(Object.hasOwn(byUid.get("sm_flag"), "error"), false);
  assert.equal(byUid.get("sm_text").error, "model timeout");
  assert.equal(Object.hasOwn(byUid.get("sm_none"), "error"), false);
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
});

test("v15 documents are not re-migrated for message error flags", () => {
  const result = migrateSessionDocument(
    sessionWith([message("sm_flag", { error: false })], SESSION_ARTIFACT_SCHEMA_VERSION),
  );
  assert.equal(result.migrations.includes("message-error-text-v15"), false);
  assert.equal(result.document.messages[0].error, false);
});
