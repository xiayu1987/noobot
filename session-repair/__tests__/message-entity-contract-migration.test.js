/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { migrateSessionDocument, SESSION_REPAIR_ERROR_CODE } from "../src/index.js";
import { releasedSession } from "./helpers/released-session.js";

const MIGRATION = "message-entity-contract-v17";

function message(messageUid, extra) {
  return {
    messageUid,
    sessionId: "session-1",
    dialogProcessId: `dialog-${messageUid}`,
    turnScopeId: `turn-${messageUid}`,
    role: "user",
    type: "message",
    content: "hi",
    ...extra,
  };
}

function sessionWith(messages, extra = {}) {
  return releasedSession({
    schemaVersion: 16,
    sessionId: "session-1",
    aggregateVersion: 0,
    messages,
    ...extra,
  });
}

function isUnmigratable(reason) {
  return (error) =>
    error.code === SESSION_REPAIR_ERROR_CODE.MESSAGE_ENTITY_UNMIGRATABLE &&
    error.message.includes(reason);
}

test("v17 backfills natural origin for root dialog users", () => {
  const result = migrateSessionDocument(sessionWith([message("u1"), message("u2")]));
  assert.ok(result.migrations.includes(MIGRATION));
  assert.deepEqual(
    result.document.messages.map((item) => item.messageOrigin),
    ["natural", "natural"],
  );
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
});

test("v17 runs before write-time dialog facts so backfilled users stay dialog anchors", () => {
  const result = migrateSessionDocument(
    sessionWith([message("u1"), message("u2")], { schemaVersion: 11 }),
  );
  assert.deepEqual(
    result.document.dialogOrder.map(({ userMessageUid }) => userMessageUid),
    ["u1", "u2"],
  );
});

test("v17 rejects child session dialog users without a recorded origin", () => {
  assert.throws(
    () => migrateSessionDocument(sessionWith([message("u1")], { parentSessionId: "parent-1" })),
    isUnmigratable("child_session_message_origin_missing"),
  );
});

test("v17 keeps recorded child origins and rejects non-canonical values", () => {
  const result = migrateSessionDocument(
    sessionWith([message("u1", { messageOrigin: "internal" })], { parentSessionId: "parent-1" }),
  );
  assert.equal(result.document.messages[0].messageOrigin, "internal");
  assert.throws(
    () => migrateSessionDocument(sessionWith([message("u1", { messageOrigin: "Natural" })])),
    isUnmigratable("message_origin_invalid"),
  );
});

test("v17 drops origin from non-dialog messages", () => {
  const result = migrateSessionDocument(
    sessionWith([
      message("u1", { messageOrigin: "natural" }),
      message("g1", { injectedMessage: true, messageOrigin: "" }),
      message("a1", { role: "assistant", messageOrigin: "" }),
    ]),
  );
  const byUid = new Map(result.document.messages.map((item) => [item.messageUid, item]));
  assert.equal(byUid.get("u1").messageOrigin, "natural");
  assert.equal(Object.hasOwn(byUid.get("g1"), "messageOrigin"), false);
  assert.equal(Object.hasOwn(byUid.get("a1"), "messageOrigin"), false);
});

test("v17 materializes attachments as arrays and rejects malformed entities", () => {
  const files = [{ attachmentId: "a-1" }];
  const result = migrateSessionDocument(
    sessionWith([
      message("u1", { messageOrigin: "natural" }),
      message("u2", { messageOrigin: "natural", attachments: files }),
    ]),
  );
  assert.deepEqual(result.document.messages[0].attachments, []);
  assert.deepEqual(result.document.messages[1].attachments, files);
  assert.throws(
    () => migrateSessionDocument(sessionWith([message("u1", { attachments: "a-1" })])),
    isUnmigratable("attachments_invalid"),
  );
  assert.throws(
    () => migrateSessionDocument(sessionWith([message("u1", { content: null })])),
    isUnmigratable("content_not_string"),
  );
});

test("v17 documents are not re-migrated", () => {
  const migrated = migrateSessionDocument(sessionWith([message("u1")])).document;
  const repeated = migrateSessionDocument(migrated);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.migrations.includes(MIGRATION), false);
  assert.deepEqual(repeated.document, migrated);
});
