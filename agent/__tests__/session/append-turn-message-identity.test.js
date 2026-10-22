/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { appendTurns } from "../../src/session/services/session-message-service/append-turn.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

const TEST_SCOPE = Object.freeze({
  sessionDir: "/workspace/runtime/session/s1",
  resolvedParentSessionId: "",
  indexed: true,
  registered: true,
});

test("appendTurns upserts an ordered message batch with one Session save", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  let findCount = 0;
  let saveCount = 0;
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => {
        findCount += 1;
        return { session, turnScopeIds: [] };
      },
      saveTurnView: async () => {
        saveCount += 1;
      },
    },
  };

  const result = await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_assistant",
        role: "assistant",
        presentationMessageId: "pm_fx1",
        content: "tools",
        modelMessageId: "mm_assistant",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_tool_1",
        role: "tool",
        presentationMessageId: "pm_fx2",
        content: "one",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
      {
        messageUid: "sm_tool_2",
        role: "tool",
        presentationMessageId: "pm_fx3",
        content: "two",
        dialogProcessId: "dp",
        turnScopeId: "t",
      },
    ],
  });

  assert.equal(findCount, 1);
  assert.equal(saveCount, 1);
  assert.equal(result.appended, true);
  assert.deepEqual(
    result.turns.map((message) => message.messageUid),
    ["sm_assistant", "sm_tool_1", "sm_tool_2"],
  );
  assert.deepEqual(
    session.messages.map((message) => message.content),
    ["tools", "one", "two"],
  );
});

test("appendTurns supersedes the prior canonical assistant presentation in one Turn", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };
  const canonical = (messageUid, content) => ({
    messageUid,
    modelMessageId: `message-${messageUid}`,
    role: "assistant",
    content,
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    presentationMessageId: "presentation-1",
    chatPresentation: true,
  });

  await appendTurns.call(service, {
    userId: "user-1",
    sessionId: "session-1",
    turns: [canonical("assistant-1", "first")],
  });
  await assert.rejects(
    appendTurns.call(service, {
      userId: "user-1",
      sessionId: "session-1",
      turns: [
        {
          ...canonical("assistant-invalid", "invalid"),
          presentationMessageId: "",
        },
      ],
    }),
    /session_message_presentationMessageId_missing/,
  );
  assert.equal(session.messages[0].chatPresentation, true);
  await appendTurns.call(service, {
    userId: "user-1",
    sessionId: "session-1",
    turns: [canonical("assistant-2", "second")],
  });

  assert.deepEqual(
    session.messages.map((message) => [message.content, message.chatPresentation]),
    [
      ["first", false],
      ["second", true],
    ],
  );
});

test("appendTurns persists the canonical tool policy", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const policy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_BOUNDARY);
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_boundary_result",
        role: "tool",
        presentationMessageId: "pm_fx4",
        content: "summary persisted",
        dialogProcessId: "dp",
        turnScopeId: "t",
        tool_call_id: "summary_1",
        contextPolicy: policy,
      },
    ],
  });

  assert.deepEqual(session.messages[0].contextPolicy, policy);
});

test("appendTurns persists the canonical internal control message type", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_control",
        role: "user",
        type: "context_control",
        chatPresentation: false,
        content: "checkpoint",
        dialogProcessId: "dp",
        turnScopeId: "t",
        noobotInternalMessageType: "noobot.phase_summary_prompt",
      },
    ],
  });

  assert.equal(session.messages[0].noobotInternalMessageType, "noobot.phase_summary_prompt");
  assert.equal(session.messages[0].chatPresentation, false);
});

test("appendTurns preserves canonical user interjection time and sequence", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const service = {
    now: () => "2026-09-18T01:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "interjection-uid-command-1",
        role: "user",
        type: "message",
        content: "accepted constraint",
        dialogProcessId: "dp",
        turnScopeId: "t",
        injectedMessage: true,
        injectedMessageType: "noobot.user_interjection",
        interjectionSequence: 1,
        ts: "2026-09-18T01:00:00.000Z",
      },
    ],
  });

  assert.equal(session.messages[0].interjectionSequence, 1);
  assert.equal(session.messages[0].ts, "2026-09-18T01:00:00.000Z");
});

test("appendTurns leaves natural user presentation unspecified and visible", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_natural",
        role: "user",
        type: "message",
        content: "hello",
        dialogProcessId: "dp",
        turnScopeId: "t",
        messageOrigin: "natural",
      },
    ],
  });

  assert.equal("chatPresentation" in session.messages[0], false);
});

test("appendTurns updates an existing message with the same messageUid", async () => {
  const session = {
    ...createTestSessionRequiredFields(),
    currentTaskId: "",
    messages: [
      {
        messageUid: "sm_existing",
        role: "assistant",
        presentationMessageId: "pm_fx5",
        content: "partial",
        type: "message",
        modelMessageId: "message-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        ts: "2026-07-25T00:00:00.000Z",
      },
    ],
  };
  let saveCount = 0;
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {
        saveCount += 1;
      },
    },
  };

  const result = await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_existing",
        role: "assistant",
        presentationMessageId: "pm_fx6",
        content: "completed",
        type: "message",
        modelMessageId: "message-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    ],
  });

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, "completed");
  assert.equal(session.messages[0].modelMessageId, "message-1");
  assert.equal(session.messages[0].messageUid, "sm_existing");
  assert.equal(session.messages[0].ts, "2026-07-25T00:00:00.000Z");
  assert.equal(result.appended, true);
  assert.equal(result.turns[0].modelMessageId, "message-1");
  assert.equal(result.turns[0].messageUid, "sm_existing");
  assert.equal(saveCount, 1);
});

test("appendTurns keeps distinct messageUids separate when runtime message ids collide", async () => {
  const session = {
    ...createTestSessionRequiredFields(),
    currentTaskId: "",
    messages: [
      {
        messageUid: "sm_old_guidance",
        role: "user",
        content: "old guidance",
        userMessageId: "am_1g",
        dialogProcessId: "dialog-old",
        turnScopeId: "turn-old",
        ts: "2026-07-25T00:00:00.000Z",
        injectedMessage: true,
      },
    ],
  };
  const service = {
    now: () => "2026-07-25T01:00:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_new_guidance",
        role: "user",
        content: "new guidance",
        userMessageId: "am_1g",
        dialogProcessId: "dialog-new",
        turnScopeId: "turn-new",
        injectedMessage: true,
      },
    ],
  });

  assert.equal(session.messages.length, 2);
  assert.notEqual(session.messages[0].messageUid, session.messages[1].messageUid);
  assert.deepEqual(
    session.messages.map(({ content, dialogProcessId, ts }) => ({ content, dialogProcessId, ts })),
    [
      { content: "old guidance", dialogProcessId: "dialog-old", ts: "2026-07-25T00:00:00.000Z" },
      { content: "new guidance", dialogProcessId: "dialog-new", ts: "2026-07-25T01:00:00.000Z" },
    ],
  );
});

test("appendTurns rejects a turn without messageUid", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await assert.rejects(
    appendTurns.call(service, {
      userId: "u1",
      sessionId: "s1",
      turns: [{ role: "user", content: "hello" }],
    }),
    (error) =>
      error.code === "SESSION_MESSAGE_IDENTITY_INVALID" &&
      error.validationErrors.includes("session_message_uid_missing"),
  );
  assert.equal(session.messages.length, 0);
});

test("appendTurns uses messageUid as the persistence identity and validates its dialog scope", async () => {
  const session = {
    ...createTestSessionRequiredFields(),
    currentTaskId: "",
    messages: [
      {
        messageUid: "sm_fixed",
        role: "assistant",
        presentationMessageId: "pm_fx7",
        content: "partial",
        modelMessageId: "am_1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        ts: "2026-07-25T00:00:00.000Z",
      },
    ],
  };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  const updated = await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_fixed",
        role: "assistant",
        presentationMessageId: "pm_fx8",
        content: "done",
        modelMessageId: "a-different-runtime-id",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    ],
  });
  assert.equal(session.messages.length, 1);
  assert.equal(updated.appended, true);
  assert.equal(updated.turns[0].messageUid, "sm_fixed");
  assert.equal(updated.turns[0].content, "done");

  await assert.rejects(
    appendTurns.call(service, {
      userId: "u1",
      sessionId: "s1",
      turns: [
        {
          messageUid: "sm_fixed",
          role: "assistant",
          presentationMessageId: "pm_fx9",
          content: "wrong dialog",
          modelMessageId: "am_1",
          dialogProcessId: "dialog-2",
          turnScopeId: "turn-2",
        },
      ],
    }),
    (error) => error.code === "SESSION_MESSAGE_IDENTITY_CONFLICT",
  );
});

test("appendTurns preserves assistant presentation identity in the authoritative snapshot", async () => {
  const session = { ...createTestSessionRequiredFields(), currentTaskId: "" };
  const service = {
    now: () => "2026-07-25T00:01:00.000Z",
    sessionRepo: {
      withSessionMutation: async (_userId, _sessionId, operation) => operation(TEST_SCOPE),
      findTurnView: async () => ({ session, turnScopeIds: [] }),
      saveTurnView: async () => {},
    },
  };

  await appendTurns.call(service, {
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        role: "assistant",
        messageUid: "sm_analysis",
        modelMessageId: "msg_model_turn_1",
        presentationMessageId: "msg_chat_1",
        chatPresentation: false,
        content: "working through the model analysis",
        type: "tool_call",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
    ],
  });

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].presentationMessageId, "msg_chat_1");
  assert.equal(session.messages[0].chatPresentation, false);
});
