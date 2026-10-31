/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import {
  canonicalActivity,
  canonicalToolTimelineItem,
  fileToolResultText,
} from "./session-repository-boundary.summaries.fixtures.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { buildPersistedDisplaySummary } from "./session-artifact-store-v2.test-helpers.js";

test("session display summary projects persisted userMessageId and messageUid without identity fallback", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "identity-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "user",
        content: "persisted user",
        userMessageId: "msg-persisted-user",
        messageUid: "sm-persisted-user",
        messageOrigin: "natural",
        turnScopeId: "turn-identity",
      },
    ],
  });

  assert.deepEqual(
    (({ userMessageId, messageUid, role }) => ({ userMessageId, messageUid, role }))(
      summary.messages[0],
    ),
    {
      userMessageId: "msg-persisted-user",
      messageUid: "sm-persisted-user",
      role: "user",
    },
  );
});

test("session display summary preserves the canonical internal control message type", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "internal-control-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "user",
        type: "context_control",
        content: "task check prompt",
        userMessageId: "sm-task-check-prompt",
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

test("session display summary retains a workflow final assistant with stable presentation identity", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "workflow-final-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "assistant",
        type: "workflow",
        content: "final workflow body\n\n/workspace/result.md",
        messageUid: "sm-workflow-final",
        modelMessageId: "sm-workflow-final",
        presentationMessageId: "assistant-presentation-workflow",
        chatPresentation: true,
        turnScopeId: "turn-workflow",
      },
    ],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0]?.presentationMessageId, "assistant-presentation-workflow");
  assert.equal(summary.messages[0]?.content.includes("/workspace/result.md"), true);
  assert.equal(summary.messages[0]?.transferEnvelopes, undefined);
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
          turns: {
            "turn-active": {
              revision: 1,
              sequence: 1,
              turnScopeId: "turn-active",
              state: "processing",
            },
          },
        },
      }),
    /presentation_message_id_missing/,
  );
});

test("session display summary does not duplicate an active Turn with persisted assistant facts", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "active-turn-with-facts",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "assistant",
        type: "tool_call",
        tool_calls: [{ id: "call-1", name: "read_file", args: {}, type: "tool_call" }],
        content: "",
        modelMessageId: "model-tool-call",
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
          revision: 1,
          sequence: 1,
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          dialogProcessId: "dialog-active",
          state: "processing",
          startedAt: "2026-07-31T02:00:00.000Z",
        },
      },
    },
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].presentationMessageId, "presentation-active");
  assert.equal(Object.hasOwn(summary.messages[0], "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(summary.messages[0]), 1);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.notEqual(summary.messages[0].turnPlaceholder, true);
});

test("session display summary projects one explicit assistant presentation from many model messages", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "assistant-presentation-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "assistant",
        type: "tool_call",
        tool_calls: [{ id: "tool-1", name: "read_file", args: {}, type: "tool_call" }],
        content: "",
        messageUid: "sm-tool-call",
        modelMessageId: "model-tool-call",
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
            presentationMessageId: "presentation-1",
          }),
        ],
        toolTimeline: [
          canonicalToolTimelineItem({
            toolCallId: "tool-1",
            tool: "read_file",
            args: { filePath: "notes.txt" },
            call: { eventId: "tool-call-1", sequence: 2 },
            result: fileToolResultText("notes.txt", { content: "notes" }),
            success: true,
            resultEvent: { eventId: "tool-result-1", sequence: 3 },
          }),
        ],
      },
      {
        attachments: [],
        role: "assistant",
        type: "message",
        content: "final answer",
        messageUid: "sm-final",
        modelMessageId: "model-final",
        presentationMessageId: "presentation-1",
        chatPresentation: true,
        turnScopeId: "turn-1",
      },
    ],
  });

  assert.equal(summary.messages.length, 1);
  assert.equal(Object.hasOwn(summary.messages[0], "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(summary.messages[0]), 3);
  assert.equal(summary.messages[0].activityTimeline.length, 1);
  assert.equal(summary.messages[0].toolTimeline.length, 1);
  assert.deepEqual(
    (({ presentationMessageId, messageUid, modelMessageId, content }) => ({
      presentationMessageId,
      messageUid,
      modelMessageId,
      content,
    }))(summary.messages[0]),
    {
      presentationMessageId: "presentation-1",
      messageUid: "sm-final",
      modelMessageId: "model-final",
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
            attachments: [],
            role: "assistant",
            content: "first",
            messageUid: "assistant-1",
            modelMessageId: "model-1",
            presentationMessageId: "presentation-1",
            chatPresentation: true,
            turnScopeId: "turn-1",
          },
          {
            attachments: [],
            role: "assistant",
            content: "second",
            messageUid: "assistant-2",
            modelMessageId: "model-2",
            presentationMessageId: "presentation-1",
            chatPresentation: true,
            turnScopeId: "turn-1",
          },
        ],
      }),
    /multiple canonical assistant presentations/,
  );
});
