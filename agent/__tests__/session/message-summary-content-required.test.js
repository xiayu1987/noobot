/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDisplayMessageSummary,
  buildMessageSummary,
} from "../../src/session/session-summary-builders/message-summary-projection.js";

test("message summary keeps empty string content instead of dropping the field", () => {
  const summary = buildMessageSummary({
    attachments: [],
    role: "assistant",
    type: "message",
    content: "",
  });
  assert.equal(summary.content, "");
});

test("display summary of a mid-turn tool_call assistant message keeps string content", () => {
  const summary = buildDisplayMessageSummary({
    attachments: [],
    role: "assistant",
    type: "message",
    chatPresentation: true,
    content: "",
    tool_calls: [{ id: "call-1", function: { name: "execute_script" } }],
  });
  assert.equal(typeof summary.content, "string");
  assert.equal(summary.content, "");
});

test("display summary of a tool_call promoted by activity keeps empty string content", () => {
  const summary = buildDisplayMessageSummary({
    attachments: [],
    role: "assistant",
    type: "tool_call",
    content: "",
    turnScopeId: "client-turn:t1",
    tool_calls: [{ id: "call-1", function: { name: "execute_script" } }],
    activityTimeline: [
      {
        eventId: "evt-1",
        eventType: "thinking",
        text: "plan",
        sequence: 1,
        sequenceScopeId: "scope-1",
        sequenceDomain: "turn",
        authority: "authoritative",
        timestamp: "2026-10-26T06:55:27.470Z",
        sessionId: "s1",
        turnScopeId: "client-turn:t1",
        presentationMessageId: "pm-1",
      },
    ],
  });
  assert.equal(summary.sourceMessageType, "tool_call");
  assert.equal(summary.type, "message");
  assert.equal(Object.hasOwn(summary, "content"), true);
  assert.equal(summary.content, "");
});
