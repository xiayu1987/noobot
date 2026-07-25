/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { appendTurn } from "../../../src/system-core/session/services/session-message-service/append-turn.js";

test("appendTurn updates an existing message with the same authoritative messageId", async () => {
  const session = {
    currentTaskId: "",
    messages: [{
      role: "assistant",
      content: "partial",
      type: "message",
      id: "message-1",
      messageId: "message-1",
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
  });

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, "completed");
  assert.equal(session.messages[0].id, "message-1");
  assert.equal(session.messages[0].messageId, "message-1");
  assert.equal(session.messages[0].ts, "2026-07-25T00:00:00.000Z");
  assert.equal(result.messageId, "message-1");
  assert.equal(saveCount, 1);
});

test("appendTurn still appends messages without an authoritative messageId", async () => {
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
  assert.equal("messageId" in session.messages[0], false);
});
