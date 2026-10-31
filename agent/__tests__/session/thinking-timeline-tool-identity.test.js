/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compactThinkingTimeline } from "../../src/session/session-summary-builders/message-summary-projection.js";
import { projectThinkingTimeline } from "../../src/session/thinking-timeline-projection.js";

test("compact tool timeline requires the reducer-written key and toolCallId", () => {
  assert.throws(
    () => compactThinkingTimeline([{ tool_call_id: "call-1", tool: "read_file" }]),
    TypeError,
  );
  assert.throws(
    () => compactThinkingTimeline([{ toolCallId: "call-2", tool: "read_file" }]),
    TypeError,
  );
  const [canonical] = compactThinkingTimeline([
    { key: "call:call-2", toolCallId: "call-2", tool: "read_file" },
  ]);
  assert.equal(canonical.key, "call:call-2");
  assert.equal(canonical.toolCallId, "call-2");
});

test("thinking timeline merges the cumulative entry of one call across messages by canonical key", () => {
  const start = { key: "call:b", toolCallId: "b", tool: "read_file", status: "running" };
  const done = { ...start, status: "completed" };
  const messages = [
    { role: "assistant", turnScopeId: "turn-1", toolTimeline: [start] },
    { role: "assistant", turnScopeId: "turn-1", toolTimeline: [done] },
  ];
  const { toolTimeline } = projectThinkingTimeline(messages, { turnScopeId: "turn-1" });
  assert.deepEqual(toolTimeline, [done]);
});

test("thinking timeline rejects tool entries without the reducer-written identity", () => {
  for (const item of [
    { tool_call_id: "a", status: "running" },
    { key: "b", status: "running" },
    { key: "call:c", toolCallId: "d", status: "running" },
  ]) {
    assert.throws(
      () =>
        projectThinkingTimeline(
          [{ role: "assistant", turnScopeId: "turn-1", toolTimeline: [item] }],
          {
            turnScopeId: "turn-1",
          },
        ),
      TypeError,
    );
  }
});
