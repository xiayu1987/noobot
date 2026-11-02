/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_AUTO_TITLE_MAX_LENGTH,
  assertSessionMessageRecordIdentity,
  deriveSessionAutoTitle,
  projectSessionMessageRecordIdentity,
  resolveSessionAutoTitle,
  validateSessionMessageRecordIdentity,
} from "../src/aggregate/session-message-record.js";
import { MESSAGE_REMOVED_FIELD_NAME } from "../src/identity/message-identity-schema.js";

const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

test("record admission and projection reject damaged identities without repairing input", () => {
  const cases = [
    ["user", "messageUid"],
    ["user", "userMessageId"],
    ["assistant", "modelMessageId"],
    ["assistant", "presentationMessageId"],
  ];
  for (const [role, field] of cases) {
    for (const value of ["", " x", "x ", "\t", null, undefined, 42, {}]) {
      const source = {
        sessionId: "s",
        role,
        messageUid: "historical-uid",
        ...(role === "assistant"
          ? { modelMessageId: "old-model", presentationMessageId: "old-view" }
          : {}),
        [field]: value,
      };
      const before = structuredClone(source);
      assert.notDeepEqual(validateSessionMessageRecordIdentity(source), []);
      assert.throws(() => projectSessionMessageRecordIdentity(source), {
        code: "SESSION_MESSAGE_IDENTITY_INVALID",
      });
      assert.deepEqual(source, before);
    }
  }
  for (const source of [null, undefined, [], "record"]) {
    assert.deepEqual(validateSessionMessageRecordIdentity(source), [
      "session_message_record_not_object",
    ]);
  }
});

test("record projection preserves historical non-prefixed identities and absent optional identity", () => {
  const source = { sessionId: "s", role: "user", messageUid: "old-uid" };
  assert.deepEqual(projectSessionMessageRecordIdentity(source), { messageUid: "old-uid" });
  assert.deepEqual(projectSessionMessageRecordIdentity({ ...source, userMessageId: "client-42" }), {
    messageUid: "old-uid",
    userMessageId: "client-42",
  });
  assert.throws(() => projectSessionMessageRecordIdentity({ ...source, role: " user " }), {
    code: "SESSION_MESSAGE_IDENTITY_INVALID",
  });
});

test("session message identity reads each role from its own field", () => {
  const assistant = {
    sessionId: "s",
    role: "assistant",
    messageUid: "sm_a",
    modelMessageId: "msg_m",
    presentationMessageId: "pm_a",
  };
  const user = { sessionId: "s", role: "user", messageUid: "sm_u", userMessageId: "msg_u" };
  assert.deepEqual(projectSessionMessageRecordIdentity(assistant), {
    messageUid: "sm_a",
    modelMessageId: "msg_m",
    presentationMessageId: "pm_a",
  });
  assert.deepEqual(projectSessionMessageRecordIdentity(user), {
    messageUid: "sm_u",
    userMessageId: "msg_u",
  });
  assert.deepEqual(validateSessionMessageRecordIdentity(assistant), []);
  assert.deepEqual(validateSessionMessageRecordIdentity(user), []);
  assert.deepEqual(
    validateSessionMessageRecordIdentity({ sessionId: "s", role: "user", messageUid: "sm_i" }),
    [],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      sessionId: "s",
      role: "tool",
      messageUid: "sm_t",
      presentationMessageId: "pm_a",
    }),
    [],
  );
});

test("session message identity rejects legacy, misplaced and missing identities", () => {
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      sessionId: "s",
      role: "tool",
      messageUid: "sm_t",
      presentationMessageId: "pm_a",
      [LEGACY_MESSAGE_ID]: "sm_t",
    }),
    ["session_message_messageId_removed"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      sessionId: "s",
      role: "tool",
      messageUid: "sm_t",
      presentationMessageId: "pm_a",
      id: "sm_t",
    }),
    ["session_message_id_removed"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      sessionId: "s",
      role: "user",
      messageUid: "sm_u",
      userMessageId: "um_u",
      userMetaMaterialized: true,
    }),
    ["session_message_userMetaMaterialized_removed"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      sessionId: "s",
      role: "user",
      messageUid: "sm_u",
      modelMessageId: "m",
    }),
    ["session_message_modelMessageId_forbidden_for_user"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({ sessionId: "s", role: "system", userMessageId: "u" }),
    ["session_message_uid_missing", "session_message_userMessageId_forbidden_for_system"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({ sessionId: "s", role: "assistant", messageUid: "sm" }),
    ["session_message_modelMessageId_missing", "session_message_presentationMessageId_missing"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({ sessionId: "s", role: "tool", messageUid: "sm_t" }),
    ["session_message_presentationMessageId_missing"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      sessionId: "s",
      role: "user",
      messageUid: "sm_u",
      presentationMessageId: "pm_a",
    }),
    ["session_message_presentationMessageId_forbidden_for_user"],
  );
  for (const sessionId of [undefined, "", " s "]) {
    assert.deepEqual(
      validateSessionMessageRecordIdentity({ sessionId, role: "user", messageUid: "sm_u" }),
      ["session_message_session_id_missing"],
    );
  }
  assert.throws(
    () =>
      assertSessionMessageRecordIdentity({
        sessionId: "s",
        role: "assistant",
        messageUid: "sm",
        [LEGACY_MESSAGE_ID]: "x",
      }),
    (error) => error.code === "SESSION_MESSAGE_IDENTITY_INVALID",
  );
});

test("session auto title comes from the first non-injected user message with content", () => {
  assert.equal(
    deriveSessionAutoTitle([
      { sessionId: "s", role: "assistant", content: "hello" },
      { sessionId: "s", role: "user", injectedMessage: true, content: "injected" },
      { sessionId: "s", role: "user", content: "   " },
      { role: "USER", content: "first real question" },
      { sessionId: "s", role: "user", content: "second question" },
    ]),
    "first real question",
  );
});

test("session auto title truncates to the protocol length", () => {
  const content = "x".repeat(SESSION_AUTO_TITLE_MAX_LENGTH + 5);
  assert.equal(resolveSessionAutoTitle({ sessionId: "s", role: "user", content }).length, 20);
});

test("session auto title is empty when no message qualifies", () => {
  assert.equal(deriveSessionAutoTitle([{ sessionId: "s", role: "assistant", content: "a" }]), "");
  assert.equal(resolveSessionAutoTitle({ sessionId: "s", role: "user", content: "" }), "");
});
