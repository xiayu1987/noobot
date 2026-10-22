/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_REMOVED_FIELD_NAME,
  SESSION_ARTIFACT_MESSAGE_IDENTITY_SCHEMA_VERSION,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { SESSION_MESSAGE_IDENTITY_MIGRATION } from "../src/message-identity-migration.js";

const LEGACY_SCHEMA_VERSION = SESSION_ARTIFACT_MESSAGE_IDENTITY_SCHEMA_VERSION - 1;
const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;
const LEGACY_FIELDS = [LEGACY_MESSAGE_ID, "id", "replacementUserMessageId"];

function message(role, overrides = {}) {
  return {
    role,
    content: role,
    dialogProcessId: "d1",
    turnScopeId: "t1",
    messageUid: `sm_${role}`,
    ...overrides,
  };
}

function legacyDocument(messages, turnLifecycle = {}) {
  return {
    schemaVersion: LEGACY_SCHEMA_VERSION,
    sessionId: "s1",
    caller: "user",
    aggregateVersion: 1,
    messages,
    turnLifecycle: { commandReceipts: [], ...turnLifecycle },
  };
}

function residue(value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => residue(item, found));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (LEGACY_FIELDS.includes(key)) found.push(key);
      residue(item, found);
    }
  }
  return found;
}

test("schema chain migrates legacy message ids for every role", () => {
  const result = migrateSessionDocument(
    legacyDocument(
      [
        message("user", { id: "msg_u1", [LEGACY_MESSAGE_ID]: "msg_u1" }),
        message("assistant", { id: "msg_a1" }),
        message("tool", { id: "sm_tool", [LEGACY_MESSAGE_ID]: "sm_tool" }),
      ],
      {
        replacedTurns: {
          t0: { replacementUserMessageId: "sm_user", replacementDialogProcessId: "d1" },
        },
      },
    ),
  );
  assert.equal(result.changed, true);
  assert.ok(result.migrations.includes(SESSION_MESSAGE_IDENTITY_MIGRATION));
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  const [user, assistant, tool] = result.document.messages;
  assert.equal(user.userMessageId, "msg_u1");
  assert.equal(assistant.modelMessageId, "msg_a1");
  assert.equal(tool.messageUid, "sm_tool");
  assert.equal(result.document.turnLifecycle.replacedTurns.t0.replacementUserMessageUid, "sm_user");
  assert.deepEqual(residue(result.document), []);
});

test("schema chain rejects a tool message id that is not its messageUid", () => {
  assert.throws(
    () =>
      migrateSessionDocument(
        legacyDocument([message("tool", { id: "msg_other", [LEGACY_MESSAGE_ID]: "msg_other" })]),
      ),
    (error) => error.code === "SESSION_MESSAGE_RECORD_MIGRATION_INVALID",
  );
});

test("canonical schema documents skip the message identity step", () => {
  const result = migrateSessionDocument({
    ...legacyDocument([message("user", { userMessageId: "um_1" })]),
    schemaVersion: SESSION_ARTIFACT_MESSAGE_IDENTITY_SCHEMA_VERSION,
  });
  assert.equal(result.migrations.includes(SESSION_MESSAGE_IDENTITY_MIGRATION), false);
});
