/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { appendTurn, appendTurns } from "../../src/session/services/session-message-service/append-turn.js";

test("appendTurns upserts an ordered message batch with one Session save", async () => {
  const session = { currentTaskId: "", messages: [] };
  let findCount = 0;
  let saveCount = 0;
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    _withSessionMutation: async (_userId, _sessionId, mutation) => mutation(),
    _resolveParentSessionId: async () => "",
    sessionRepo: {
      findById: async () => { findCount += 1; return session; },
      save: async () => { saveCount += 1; },
    },
  };

  const result = await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      { messageUid: "sm_assistant", role: "assistant", content: "tools", dialogProcessId: "dp", turnScopeId: "t" },
      { messageUid: "sm_tool_1", role: "tool", content: "one", dialogProcessId: "dp", turnScopeId: "t" },
      { messageUid: "sm_tool_2", role: "tool", content: "two", dialogProcessId: "dp", turnScopeId: "t" },
    ],
  });

  assert.equal(findCount, 1);
  assert.equal(saveCount, 1);
  assert.deepEqual(result.map((message) => message.messageUid), ["sm_assistant", "sm_tool_1", "sm_tool_2"]);
  assert.deepEqual(session.messages.map((message) => message.content), ["tools", "one", "two"]);
});

test("appendTurn updates an existing message with the same authoritative messageId", async () => {
  const session = {
    currentTaskId: "",
    messages: [{
      role: "assistant",
      content: "partial",
      type: "message",
      id: "message-1",
      messageId: "message-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      ts: "2026-07-25T00:00:00.000Z",
    }],
  };
  let saveCount = 0;
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    _withSessionMutation: async (_userId, _sessionId, mutation) => mutation(),
    _resolveParentSessionId: async () => "",
    sessionRepo: {
      findById: async () => session,
      save: async () => { saveCount += 1; },
    },
  };

  const result = await appendTurn.call(service, {
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    content: "completed",
    type: "message",
    messageId: "message-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  });

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, "completed");
  assert.equal(session.messages[0].id, "message-1");
  assert.equal(session.messages[0].messageId, "message-1");
  assert.match(session.messages[0].messageUid, /^sm_/);
  assert.equal(session.messages[0].ts, "2026-07-25T00:00:00.000Z");
  assert.equal(result.messageId, "message-1");
  assert.equal(result.messageUid, session.messages[0].messageUid);
  assert.equal(saveCount, 1);
});

test("appendTurn does not overwrite another dialog when local message ids collide", async () => {
  const session = {
    currentTaskId: "",
    messages: [{
      role: "user",
      content: "old guidance",
      id: "am_1g",
      messageId: "am_1g",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-old",
      ts: "2026-07-25T00:00:00.000Z",
      injectedMessage: true,
    }],
  };
  const service = {
    now: () => "2026-07-25T01:00:00.000Z",
    _withSessionMutation: async (_userId, _sessionId, mutation) => mutation(),
    _resolveParentSessionId: async () => "",
    sessionRepo: { findById: async () => session, save: async () => {} },
  };

  await appendTurn.call(service, {
    userId: "u1", sessionId: "s1", role: "user", content: "new guidance",
    messageId: "am_1g", dialogProcessId: "dialog-new", turnScopeId: "turn-new",
    injectedMessage: true,
  });

  assert.equal(session.messages.length, 2);
  assert.notEqual(session.messages[0].messageUid, session.messages[1].messageUid);
  assert.deepEqual(session.messages.map(({ content, dialogProcessId, ts }) => ({ content, dialogProcessId, ts })), [
    { content: "old guidance", dialogProcessId: "dialog-old", ts: "2026-07-25T00:00:00.000Z" },
    { content: "new guidance", dialogProcessId: "dialog-new", ts: "2026-07-25T01:00:00.000Z" },
  ]);
});

test("appendTurn assigns a stable persisted identity when no runtime messageId is provided", async () => {
  const session = { currentTaskId: "", messages: [] };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    _withSessionMutation: async (_userId, _sessionId, mutation) => mutation(),
    _resolveParentSessionId: async () => "",
    sessionRepo: {
      findById: async () => session,
      save: async () => {},
    },
  };

  await appendTurn.call(service, {
    userId: "u1",
    sessionId: "s1",
    role: "user",
    content: "hello",
  });

  assert.equal(session.messages.length, 1);
  assert.match(session.messages[0].messageUid, /^sm_/);
  assert.equal(session.messages[0].messageId, session.messages[0].messageUid);
  assert.equal(session.messages[0].id, session.messages[0].messageUid);
});

test("appendTurn uses messageUid as the persistence identity and validates its dialog scope", async () => {
  const session = {
    currentTaskId: "",
    messages: [{
      messageUid: "sm_fixed",
      role: "assistant", content: "partial", messageId: "am_1",
      dialogProcessId: "dialog-1", turnScopeId: "turn-1",
      ts: "2026-07-25T00:00:00.000Z",
    }],
  };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    _withSessionMutation: async (_userId, _sessionId, mutation) => mutation(),
    _resolveParentSessionId: async () => "",
    sessionRepo: { findById: async () => session, save: async () => {} },
  };

  const updated = await appendTurn.call(service, {
    userId: "u1", sessionId: "s1", messageUid: "sm_fixed",
    role: "assistant", content: "done", messageId: "a-different-runtime-id",
    dialogProcessId: "dialog-1", turnScopeId: "turn-1",
  });
  assert.equal(session.messages.length, 1);
  assert.equal(updated.messageUid, "sm_fixed");
  assert.equal(updated.content, "done");

  await assert.rejects(appendTurn.call(service, {
    userId: "u1", sessionId: "s1", messageUid: "sm_fixed",
    role: "assistant", content: "wrong dialog", messageId: "am_1",
    dialogProcessId: "dialog-2", turnScopeId: "turn-2",
  }), (error) => error.code === "SESSION_MESSAGE_IDENTITY_CONFLICT");

  await assert.rejects(appendTurn.call(service, {
    userId: "u1", sessionId: "s1", messageUid: "sm_unknown",
    role: "assistant", content: "ambiguous update", messageId: "a-different-runtime-id",
    dialogProcessId: "dialog-1", turnScopeId: "turn-1",
  }), (error) => error.code === "SESSION_MESSAGE_UID_MISMATCH");
});

test("appendTurn preserves assistant presentation identity in the authoritative snapshot", async () => {
  const session = { currentTaskId: "", messages: [] };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    _withSessionMutation: async (_userId, _sessionId, mutation) => mutation(),
    _resolveParentSessionId: async () => "",
    sessionRepo: { findById: async () => session, save: async () => {} },
  };

  await appendTurn.call(service, {
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    messageUid: "sm_analysis",
    messageId: "msg_model_turn_1",
    presentationMessageId: "msg_chat_1",
    chatPresentation: false,
    content: "working through the model analysis",
    type: "tool_call",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  });

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].presentationMessageId, "msg_chat_1");
  assert.equal(session.messages[0].chatPresentation, false);
});
