/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { deriveWriteTimeDialogOrder } from "../src/write-time-dialog-facts.js";
import { releasedSession } from "./helpers/released-session.js";

function migrateReleased(fields) {
  return migrateSessionDocument(releasedSession(fields));
}

function checkpointReceipt({ checkpointId, checkpointRevision, uid }) {
  return {
    checkpointId,
    checkpointRevision,
    requestHash: `sha256:${checkpointId}`,
    persistedMessageUids: [uid],
    summarizedMessageUids: [uid],
    retainedMessageUids: [],
    markedCount: 1,
    committedAt: "2026-01-01T00:02:00.000Z",
  };
}

test("invalid persisted ordinals are dropped and re-registered after the current maximum", () => {
  const messages = [
    { messageUid: "u1", role: "user", dialogProcessId: "d1", turnScopeId: "t1", ts: "a" },
    { messageUid: "u2", role: "user", dialogProcessId: "d2", turnScopeId: "t2", ts: "b" },
    { messageUid: "u3", role: "user", dialogProcessId: "d3", turnScopeId: "t3", ts: "c" },
  ];
  const order = deriveWriteTimeDialogOrder(
    [
      { dialogProcessId: "d1", dialogOrdinal: "1" },
      { dialogProcessId: "d2", dialogOrdinal: 5 },
      { dialogProcessId: "d3", dialogOrdinal: 0 },
    ],
    messages,
  );
  assert.deepEqual(
    order.map(({ dialogProcessId, dialogOrdinal }) => [dialogProcessId, dialogOrdinal]),
    [
      ["d2", 5],
      ["d1", 6],
      ["d3", 7],
    ],
  );
});

test("migrates v11 dialog order and summary receipts into write-time facts", () => {
  const source = {
    schemaVersion: 11,
    sessionId: "session-1",
    messages: [
      {
        messageUid: "u1",
        role: "user",
        content: "first question",
        dialogProcessId: "d1",
        turnScopeId: "t1",
        ts: "2026-01-01T00:00:00.000Z",
      },
      {
        messageUid: "u2",
        role: "user",
        dialogProcessId: "d2",
        turnScopeId: "t2",
        ts: "2026-01-01T00:01:00.000Z",
      },
    ],
    turnSummaryCheckpoints: {
      t1: {
        dialogProcessId: "d1",
        turnScopeId: "t1",
        checkpointRevision: 2,
        receipts: [
          checkpointReceipt({ checkpointId: "live", checkpointRevision: 1, uid: "u1" }),
          checkpointReceipt({ checkpointId: "dangling", checkpointRevision: 2, uid: "gone" }),
        ],
      },
      gone: { dialogProcessId: "d9", turnScopeId: "gone", checkpointRevision: 0, receipts: [] },
    },
  };

  const result = migrateReleased(source);

  assert.ok(result.migrations.includes("session-write-time-dialog-facts-v12"));
  assert.deepEqual(
    result.document.dialogOrder.map(({ dialogProcessId, userMessageUid, dialogOrdinal }) => ({
      dialogProcessId,
      userMessageUid,
      dialogOrdinal,
    })),
    [
      { dialogProcessId: "d1", userMessageUid: "u1", dialogOrdinal: 1 },
      { dialogProcessId: "d2", userMessageUid: "u2", dialogOrdinal: 2 },
    ],
  );
  assert.equal(result.document.autoTitle, "first question");
  assert.deepEqual(Object.keys(result.document.turnSummaryCheckpoints), ["t1"]);
  assert.deepEqual(
    result.document.turnSummaryCheckpoints.t1.receipts.map((item) => item.checkpointId),
    ["live"],
  );
  const repeated = migrateReleased({
    ...result.document,
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
  });
  assert.equal(repeated.migrations.includes("session-write-time-dialog-facts-v12"), false);
  assert.deepEqual(repeated.document.dialogOrder, result.document.dialogOrder);
  assert.equal(repeated.document.autoTitle, "first question");
});

test("v12 migration rejects checkpoint state missing checkpointRevision", () => {
  const source = {
    schemaVersion: 11,
    sessionId: "session-1",
    messages: [
      {
        messageUid: "u1",
        role: "user",
        content: "q",
        dialogProcessId: "d1",
        turnScopeId: "t1",
        ts: "2026-01-01T00:00:00.000Z",
      },
    ],
    turnSummaryCheckpoints: {
      t1: {
        dialogProcessId: "d1",
        turnScopeId: "t1",
        receipts: [checkpointReceipt({ checkpointId: "live", checkpointRevision: 1, uid: "u1" })],
      },
    },
  };
  assert.throws(
    () => migrateReleased(source),
    (error) => error.code === "INVALID_TURN_SUMMARY_CHECKPOINT_STATE",
  );
});
