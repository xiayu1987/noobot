/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import { canonicalActivity } from "./session-repository-boundary.summaries.fixtures.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

test("session display summary projects persisted messageId and messageUid without identity fallback", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "identity-session",
    aggregateVersion: 0,
    messages: [
      {
        role: "user",
        content: "persisted user",
        messageId: "msg-persisted-user",
        messageUid: "sm-persisted-user",
        messageOrigin: "natural",
        userMetaMaterialized: true,
        turnScopeId: "turn-identity",
      },
    ],
  });

  assert.deepEqual(
    (({ messageId, messageUid, role }) => ({ messageId, messageUid, role }))(summary.messages[0]),
    {
      messageId: "msg-persisted-user",
      messageUid: "sm-persisted-user",
      role: "user",
    },
  );
});

test("session display summary preserves the canonical internal control message type", () => {
  const summary = buildSessionDisplaySummary({
    ...createTestSessionRequiredFields(),
    sessionId: "internal-control-session",
    aggregateVersion: 0,
    messages: [
      {
        role: "user",
        type: "context_control",
        content: "task check prompt",
        messageId: "sm-task-check-prompt",
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
    ...createTestSessionRequiredFields(),
    sessionId: "workflow-final-session",
    aggregateVersion: 0,
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
    ...createTestSessionRequiredFields(),
    sessionId: "workflow-lifecycle-session",
    aggregateVersion: 0,
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
      ...createEmptyTurnLifecycle(),
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
        ...createTestSessionRequiredFields(),
        sessionId: "invalid-active-turn-session",
        aggregateVersion: 0,
        messages: [],
        turnLifecycle: {
          ...createEmptyTurnLifecycle(),
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
        ...createTestSessionRequiredFields(),
        sessionId: "conflicting-active-turn-session",
        aggregateVersion: 0,
        messages: [
          {
            role: "user",
            content: "conflicting identity",
            messageId: "presentation-active",
            turnScopeId: "turn-active",
          },
        ],
        turnLifecycle: {
          ...createEmptyTurnLifecycle(),
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
    ...createTestSessionRequiredFields(),
    sessionId: "active-turn-with-facts",
    aggregateVersion: 0,
    messages: [
      {
        role: "assistant",
        type: "tool_call",
        content: "",
        messageId: "model-tool-call",
        presentationMessageId: "presentation-active",
        chatPresentation: false,
        turnScopeId: "turn-active",
        activityTimeline: [
          canonicalActivity({
            eventId: "thinking-1",
            text: "working",
            sequenceScopeId: "model-tool-call",
            sessionId: "active-turn-with-facts",
            turnScopeId: "turn-active",
            messageId: "model-tool-call",
            presentationMessageId: "presentation-active",
          }),
        ],
      },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
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
    ...createTestSessionRequiredFields(),
    sessionId: "assistant-presentation-session",
    aggregateVersion: 0,
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
          canonicalActivity({
            eventId: "thinking-1",
            text: "working",
            sequenceScopeId: "model-tool-call",
            sessionId: "assistant-presentation-session",
            turnScopeId: "turn-1",
            messageId: "model-tool-call",
            presentationMessageId: "presentation-1",
          }),
        ],
        toolTimeline: [
          {
            key: "call:tool-1",
            toolCallId: "tool-1",
            status: "completed",
            call: { eventId: "tool-call-1", sequence: 2 },
            resultEvent: { eventId: "tool-result-1", sequence: 3 },
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
  assert.equal(summary.messages[0].thinkingDetailCount, 3);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.equal(summary.messages[0].toolTimeline.length, 1);
  assert.deepEqual(
    (({ messageId, messageUid, sourceMessageId, sourceMessageUid, content }) => ({
      messageId,
      messageUid,
      sourceMessageId,
      sourceMessageUid,
      content,
    }))(summary.messages[0]),
    {
      messageId: "presentation-1",
      messageUid: undefined,
      sourceMessageId: "model-final",
      sourceMessageUid: "sm-final",
      content: "final answer",
    },
  );
});

test("session display summary rejects multiple canonical assistants for one presentation", () => {
  assert.throws(
    () =>
      buildSessionDisplaySummary({
        ...createTestSessionRequiredFields(),
        sessionId: "duplicate-presentation-session",
        aggregateVersion: 0,
        messages: [
          {
            role: "assistant",
            content: "first",
            messageUid: "assistant-1",
            messageId: "model-1",
            presentationMessageId: "presentation-1",
            chatPresentation: true,
            turnScopeId: "turn-1",
          },
          {
            role: "assistant",
            content: "second",
            messageUid: "assistant-2",
            messageId: "model-2",
            presentationMessageId: "presentation-1",
            chatPresentation: true,
            turnScopeId: "turn-1",
          },
        ],
      }),
    /multiple canonical assistant presentations/,
  );
});
