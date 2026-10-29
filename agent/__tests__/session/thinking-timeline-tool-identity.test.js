/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compactThinkingTimeline } from "../../src/session/session-summary-builders/message-summary-projection.js";
import { projectThinkingTimeline } from "../../src/session/thinking-timeline-projection.js";

test("compact tool timeline reads key and toolCallId only", () => {
  const [item] = compactThinkingTimeline([{ tool_call_id: "call-1", tool: "read_file" }]);
  assert.equal(item.key, "");
  assert.equal(item.toolCallId, "");
  const [canonical] = compactThinkingTimeline([{ toolCallId: "call-2", tool: "read_file" }]);
  assert.equal(canonical.key, "call-2");
  assert.equal(canonical.toolCallId, "call-2");
});

test("thinking timeline merges tool entries by key or toolCallId, not tool_call_id", () => {
  const messages = [
    {
      role: "assistant",
      turnScopeId: "turn-1",
      toolTimeline: [{ tool_call_id: "a", status: "running" }],
    },
    {
      role: "assistant",
      turnScopeId: "turn-1",
      toolTimeline: [{ tool_call_id: "a", status: "done" }],
    },
    { role: "assistant", turnScopeId: "turn-1", toolTimeline: [{ key: "b", status: "running" }] },
    { role: "assistant", turnScopeId: "turn-1", toolTimeline: [{ key: "b", status: "done" }] },
  ];
  const { toolTimeline } = projectThinkingTimeline(messages, { turnScopeId: "turn-1" });
  assert.equal(toolTimeline.filter((item) => item.key === "b").length, 1);
  assert.equal(toolTimeline.filter((item) => item.tool_call_id === "a").length, 2);
});
