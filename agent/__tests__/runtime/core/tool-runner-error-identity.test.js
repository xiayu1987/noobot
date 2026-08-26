/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "./tool-runner.test-helpers.js";

test("recoverable tool errors retain the complete execution identity", async () => {
  const logs = [];
  const result = await executeToolCall({
    call: { id: "call_identity", name: "demo_tool", args: {} },
    tool: {
      invoke: async () => {
        const error = new Error("identity failure");
        error.code = "RECOVERABLE_IDENTITY_FAILURE";
        throw error;
      },
    },
    userId: "user-1",
    sessionId: "session-1",
    parentSessionId: "parent-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    executionId: "agent:turn-1",
    errorLogger: {
      async log(entry) {
        logs.push(entry);
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].userId, "user-1");
  assert.equal(logs[0].sessionId, "session-1");
  assert.equal(logs[0].parentSessionId, "parent-1");
  assert.equal(logs[0].event, "tool_invoke_error");
  assert.deepEqual(logs[0].extra, {
    toolName: "demo_tool",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    executionId: "agent:turn-1",
    toolCallId: "call_identity",
  });
});
