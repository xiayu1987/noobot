/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildThinkingDetailPayload } from "../../src/session/session-thinking-detail.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";

test("thinking detail message carries its session envelope identity and scoped injections", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "session-detail",
    sessions: [{
      sessionId: "session-detail",
      rawMessages: [
        {
          role: "assistant",
          type: "message",
          turnScopeId: "turn-detail",
          toolTimeline: [{ key: "call:one" }],
        },
        {
          role: "assistant",
          type: "message",
          turnScopeId: "turn-detail",
          injectedMessage: true,
          content: "guidance",
        },
      ],
    }],
  }, { turnScopeId: "turn-detail" });

  assert.equal(payload.messageItem.sessionId, "session-detail");
  assert.equal(payload.allMessages.filter((item) => item.injectedMessage === true).length, 1);
  assert.equal(payload.counts.injectedMessageCount, 1);
});

test("thinking detail projects the complete turn timeline onto the final assistant message", () => {
  const payload = buildThinkingDetailPayload({
    sessionId: "child-session",
    sessions: [{
      sessionId: "child-session",
      rawMessages: [
        {
          id: "tool-call-message",
          role: "assistant",
          type: "tool_call",
          turnScopeId: "workflow-node:turn-1",
          toolTimeline: [{ key: "call:one", status: "running", call: { eventId: "call-start" } }],
        },
        {
          id: "tool-result-message",
          role: "tool",
          type: "tool_result",
          turnScopeId: "workflow-node:turn-1",
          toolTimeline: [{ key: "call:one", status: "completed", resultEvent: { eventId: "call-end" } }],
        },
        {
          id: "final-assistant",
          role: "assistant",
          type: "message",
          turnScopeId: "workflow-node:turn-1",
          content: "done",
          activityTimeline: [{ eventId: "analysis-1", eventType: "thinking" }],
        },
      ],
    }],
  }, { turnScopeId: "workflow-node:turn-1" });

  assert.equal(payload.messageItem.id, "final-assistant");
  assert.equal(payload.messageItem.toolTimeline.length, 1);
  assert.equal(payload.messageItem.toolTimeline[0].status, "completed");
  assert.equal(payload.messageItem.toolTimeline[0].call.eventId, "call-start");
  assert.equal(payload.messageItem.toolTimeline[0].resultEvent.eventId, "call-end");
  assert.equal(payload.messageItem.activityTimeline.length, 1);
  assert.equal(payload.messageItem.hasThinkingDetails, true);
  assert.equal(payload.counts.executionLogCount, 1);
});

test("session summary and thinking detail project the same complete turn timeline", () => {
  const messages = [
    {
      id: "tool-call-one",
      role: "assistant",
      type: "tool_call",
      turnScopeId: "workflow-node:turn-2",
      toolTimeline: [{ key: "call:one", toolCallId: "one", status: "completed" }],
    },
    {
      id: "tool-call-two",
      role: "assistant",
      type: "tool_call",
      turnScopeId: "workflow-node:turn-2",
      toolTimeline: [{ key: "call:two", toolCallId: "two", status: "completed" }],
    },
    {
      id: "final-assistant",
      role: "assistant",
      type: "message",
      turnScopeId: "workflow-node:turn-2",
      content: "done",
    },
  ];

  const summary = buildSessionDisplaySummary({ sessionId: "child-session", messages });
  const summaryMessage = summary.messages.find((item) => item.id === "final-assistant");
  const detail = buildThinkingDetailPayload({
    sessionId: "child-session",
    sessions: [{ sessionId: "child-session", rawMessages: messages }],
  }, { turnScopeId: "workflow-node:turn-2" });

  assert.equal(summaryMessage.thinkingDetailCount, 2);
  assert.equal(summaryMessage.hasThinkingDetails, true);
  assert.equal(summaryMessage.toolTimeline.length, 2);
  assert.equal(detail.messageItem.thinkingDetailCount, summaryMessage.thinkingDetailCount);
  assert.deepEqual(detail.messageItem.toolTimeline, summaryMessage.toolTimeline);
});
