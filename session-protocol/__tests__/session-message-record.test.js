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
  resolveSessionMessageRecordModelMessageId,
  resolveSessionMessageRecordUserMessageId,
  resolveSessionAutoTitle,
  validateSessionMessageRecordIdentity,
} from "../src/aggregate/session-message-record.js";
import { MESSAGE_REMOVED_FIELD_NAME } from "../src/identity/message-identity-schema.js";

const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

test("session message identity reads each role from its own field", () => {
  const assistant = {
    sessionId: "s",
    role: "assistant",
    messageUid: "sm_a",
    modelMessageId: "msg_m",
    presentationMessageId: "pm_a",
  };
  const user = { sessionId: "s", role: "user", messageUid: "sm_u", userMessageId: "msg_u" };
  assert.equal(resolveSessionMessageRecordModelMessageId(assistant), "msg_m");
  assert.equal(resolveSessionMessageRecordUserMessageId(user), "msg_u");
  assert.equal(resolveSessionMessageRecordModelMessageId(user), "");
  assert.equal(resolveSessionMessageRecordUserMessageId(assistant), "");
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
