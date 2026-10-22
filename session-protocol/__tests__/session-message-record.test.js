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

test("session message identity reads each role from its own field", () => {
  const assistant = {
    role: "assistant",
    messageUid: "sm_a",
    modelMessageId: "msg_m",
    presentationMessageId: "pm_a",
  };
  const user = { role: "user", messageUid: "sm_u", userMessageId: "msg_u" };
  assert.equal(resolveSessionMessageRecordModelMessageId(assistant), "msg_m");
  assert.equal(resolveSessionMessageRecordUserMessageId(user), "msg_u");
  assert.equal(resolveSessionMessageRecordModelMessageId(user), "");
  assert.equal(resolveSessionMessageRecordUserMessageId(assistant), "");
  assert.deepEqual(validateSessionMessageRecordIdentity(assistant), []);
  assert.deepEqual(validateSessionMessageRecordIdentity(user), []);
  assert.deepEqual(validateSessionMessageRecordIdentity({ role: "user", messageUid: "sm_i" }), []);
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
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
      role: "tool",
      messageUid: "sm_t",
      presentationMessageId: "pm_a",
      messageId: "sm_t",
    }),
    ["session_message_messageId_removed"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      role: "tool",
      messageUid: "sm_t",
      presentationMessageId: "pm_a",
      id: "sm_t",
    }),
    ["session_message_id_removed"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      role: "user",
      messageUid: "sm_u",
      userMessageId: "um_u",
      userMetaMaterialized: true,
    }),
    ["session_message_userMetaMaterialized_removed"],
  );
  assert.deepEqual(
    validateSessionMessageRecordIdentity({ role: "user", messageUid: "sm_u", modelMessageId: "m" }),
    ["session_message_modelMessageId_forbidden_for_user"],
  );
  assert.deepEqual(validateSessionMessageRecordIdentity({ role: "system", userMessageId: "u" }), [
    "session_message_uid_missing",
    "session_message_userMessageId_forbidden_for_system",
  ]);
  assert.deepEqual(validateSessionMessageRecordIdentity({ role: "assistant", messageUid: "sm" }), [
    "session_message_modelMessageId_missing",
    "session_message_presentationMessageId_missing",
  ]);
  assert.deepEqual(validateSessionMessageRecordIdentity({ role: "tool", messageUid: "sm_t" }), [
    "session_message_presentationMessageId_missing",
  ]);
  assert.deepEqual(
    validateSessionMessageRecordIdentity({
      role: "user",
      messageUid: "sm_u",
      presentationMessageId: "pm_a",
    }),
    ["session_message_presentationMessageId_forbidden_for_user"],
  );
  assert.throws(
    () =>
      assertSessionMessageRecordIdentity({ role: "assistant", messageUid: "sm", messageId: "x" }),
    (error) => error.code === "SESSION_MESSAGE_IDENTITY_INVALID",
  );
});

test("session auto title comes from the first non-injected user message with content", () => {
  assert.equal(
    deriveSessionAutoTitle([
      { role: "assistant", content: "hello" },
      { role: "user", injectedMessage: true, content: "injected" },
      { role: "user", content: "   " },
      { role: "USER", content: "first real question" },
      { role: "user", content: "second question" },
    ]),
    "first real question",
  );
});

test("session auto title truncates to the protocol length", () => {
  const content = "x".repeat(SESSION_AUTO_TITLE_MAX_LENGTH + 5);
  assert.equal(resolveSessionAutoTitle({ role: "user", content }).length, 20);
});

test("session auto title is empty when no message qualifies", () => {
  assert.equal(deriveSessionAutoTitle([{ role: "assistant", content: "a" }]), "");
  assert.equal(resolveSessionAutoTitle({ role: "user", content: "" }), "");
});
