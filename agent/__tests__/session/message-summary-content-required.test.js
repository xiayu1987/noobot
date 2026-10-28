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
  const summary = buildMessageSummary({ role: "assistant", type: "message", content: "" });
  assert.equal(summary.content, "");
});

test("display summary of a mid-turn tool_call assistant message keeps string content", () => {
  const summary = buildDisplayMessageSummary({
    role: "assistant",
    type: "message",
    chatPresentation: true,
    content: "",
    tool_calls: [{ id: "call-1", function: { name: "execute_script" } }],
  });
  assert.equal(typeof summary.content, "string");
  assert.equal(summary.content, "");
});
