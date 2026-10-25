/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { migrateSessionDocument } from "../src/index.js";
import { releasedSession } from "./helpers/released-session.js";

function legacyCommittedSession(turnCommit) {
  return releasedSession({
    schemaVersion: 6,
    sessionId: "session-1",
    aggregateVersion: 1,
    messages: [
      {
        messageUid: "user-1",
        role: "user",
        content: "hello",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
        ts: "2026-01-01T00:00:00.000Z",
        turnCommit,
      },
    ],
  });
}

test("legacy turn commit migration rejects a commit without a protocol action", () => {
  for (const action of [undefined, "", "resend", "unknown"]) {
    assert.throws(
      () => migrateSessionDocument(legacyCommittedSession({ commandId: "send-1", action })),
      { code: "SESSION_TURN_COMMIT_UNMIGRATABLE" },
    );
  }
});

test("legacy turn commit migration canonicalizes a protocol action", () => {
  const result = migrateSessionDocument(
    legacyCommittedSession({ commandId: "send-1", action: " CONTINUE " }),
  );
  assert.equal(result.document.messages[0].turnCommit.action, "continue");
});
