/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */


import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";

test("session display summary projects persisted messageUid as canonical message identity", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "identity-session",
    messages: [
      {
        role: "user",
        content: "persisted user",
        messageUid: "sm-persisted-user",
        frontendUserMessage: true,
        turnScopeId: "turn-identity",
      },
    ],
  });

  assert.deepEqual(
    (({ id, messageId, messageUid, role }) => ({ id, messageId, messageUid, role }))(
      summary.messages[0],
    ),
    {
      id: "sm-persisted-user",
      messageId: "sm-persisted-user",
      messageUid: "sm-persisted-user",
      role: "user",
    },
  );
});

test("session display summary preserves the canonical internal control message type", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "internal-control-session",
    messages: [
      {
        role: "user",
        type: "context_control",
        content: "task check prompt",
        messageUid: "sm-task-check-prompt",
        turnScopeId: "turn-task-check",
        dialogProcessId: "dialog-task-check",
        noobotInternalMessageType: "noobot.task_check_prompt",
      },
    ],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0]?.noobotInternalMessageType, "noobot.task_check_prompt");
});

test("session display summary retains a workflow final assistant with stable presentation identity", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "workflow-final-session",
    messages: [
      {
        role: "assistant",
        type: "workflow",
        content: "final workflow body\n\n/workspace/result.md",
        messageUid: "sm-workflow-final",
        messageId: "sm-workflow-final",
        presentationMessageId: "assistant-presentation-workflow",
        chatPresentation: true,
        turnScopeId: "turn-workflow",
      },
    ],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0]?.messageId, "assistant-presentation-workflow");
  assert.equal(summary.messages[0]?.content.includes("/workspace/result.md"), true);
  assert.equal(summary.messages[0]?.transferEnvelopes, undefined);
});

test("session display summary does not synthesize a missing workflow presentation identity", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "workflow-lifecycle-session",
    messages: [
      {
        role: "assistant",
        type: "workflow",
        content: "persisted workflow final",
        messageUid: "sm-workflow-lifecycle",
        messageId: "sm-workflow-lifecycle",
        chatPresentation: true,
        turnScopeId: "turn-workflow-lifecycle",
      },
    ],
    turnLifecycle: {
      turns: {
        "turn-workflow-lifecycle": {
          turnScopeId: "turn-workflow-lifecycle",
          presentationMessageId: "assistant-from-lifecycle",
          state: "completed",
        },
      },
    },
  });

  assert.equal(summary.messages.length, 0);
});

test("session display summary rejects an active Turn without canonical presentation identity", () => {
  assert.throws(
    () =>
      buildSessionDisplaySummary({
        sessionId: "invalid-active-turn-session",
        messages: [],
        turnLifecycle: {
          activeTurnScopeId: "turn-active",
          turns: { "turn-active": { turnScopeId: "turn-active", state: "processing" } },
        },
      }),
    /presentation_message_id_missing/,
  );
});

test("session display summary rejects an active Turn presentation identity owned by another role", () => {
  assert.throws(
    () =>
      buildSessionDisplaySummary({
        sessionId: "conflicting-active-turn-session",
        messages: [
          {
            role: "user",
            content: "conflicting identity",
            messageId: "presentation-active",
            turnScopeId: "turn-active",
          },
        ],
        turnLifecycle: {
          activeTurnScopeId: "turn-active",
          turns: {
            "turn-active": {
              turnScopeId: "turn-active",
              presentationMessageId: "presentation-active",
              state: "processing",
            },
          },
        },
      }),
    /presentation_role_conflict/,
  );
});

test("session display summary does not duplicate an active Turn with persisted assistant facts", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "active-turn-with-facts",
    messages: [
      {
        role: "assistant",
        type: "tool_call",
        content: "",
        messageId: "model-tool-call",
        presentationMessageId: "presentation-active",
        chatPresentation: false,
        turnScopeId: "turn-active",
        activityTimeline: [{ eventId: "thinking-1", type: "thinking", text: "working" }],
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "turn-active",
      turns: {
        "turn-active": {
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          state: "processing",
        },
      },
    },
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].messageId, "presentation-active");
  assert.equal(summary.messages[0].thinkingDetailCount, 1);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.notEqual(summary.messages[0].turnPlaceholder, true);
});

test("session display summary projects one explicit assistant presentation from many model messages", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "assistant-presentation-session",
    messages: [
      {
        role: "assistant",
        type: "tool_call",
        content: "",
        messageUid: "sm-tool-call",
        messageId: "model-tool-call",
        presentationMessageId: "presentation-1",
        chatPresentation: false,
        turnScopeId: "turn-1",
        activityTimeline: [
          {
            eventId: "thinking-1",
            event: "thinking",
            type: "thinking",
            text: "working",
            sequence: 1,
            sequenceScopeId: "model-tool-call",
            sequenceDomain: "message-event",
            authority: "authoritative",
          },
        ],
        toolTimeline: [
          {
            key: "call:tool-1",
            toolCallId: "tool-1",
            status: "completed",
          },
        ],
      },
      {
        role: "assistant",
        type: "message",
        content: "final answer",
        messageUid: "sm-final",
        messageId: "model-final",
        presentationMessageId: "presentation-1",
        chatPresentation: true,
        turnScopeId: "turn-1",
      },
    ],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].thinkingDetailCount, 2);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.equal(summary.messages[0].toolTimeline.length, 1);
  assert.deepEqual(
    (({ id, messageId, messageUid, sourceMessageId, sourceMessageUid, content }) => ({
      id,
      messageId,
      messageUid,
      sourceMessageId,
      sourceMessageUid,
      content,
    }))(summary.messages[0]),
    {
      id: "presentation-1",
      messageId: "presentation-1",
      messageUid: undefined,
      sourceMessageId: "model-final",
      sourceMessageUid: "sm-final",
      content: "final answer",
    },
  );
});

