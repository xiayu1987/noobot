/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "./tool-runner.test-helpers.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { TRANSFER_ERROR_CODE } from "@noobot/semantic-transfer-protocol";
import { classifyEngineError } from "../../../src/runtime/errors/index.js";

for (const code of [
  TRANSFER_ERROR_CODE.IDENTITY_CONFLICT,
  TRANSFER_ERROR_CODE.ATTACHMENT_IDENTITY_CONFLICT,
]) {
  test(`tool runner propagates ${code} with the same fatal classification`, async () => {
    const error = Object.assign(new Error("conflicting protocol identity"), { code });
    const errors = [];
    const runtime = createTestRuntimeContext({
      eventListener: {
        onEvent: ({ event, data }) => {
          if (event === "tool_call_error") errors.push(data);
        },
      },
    });
    await assert.rejects(
      executeToolCall({
        runtime,
        call: { id: "call_conflict", name: "demo_tool", args: {} },
        tool: {
          invoke: async () => {
            throw error;
          },
        },
      }),
      (caught) => caught === error,
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0].classification, "fatal");
    assert.equal(errors[0].error.retryable, false);
    assert.equal(classifyEngineError(error), "fatal");
  });
}

test("recoverable tool errors retain the complete execution identity", async () => {
  const logs = [];
  const result = await executeToolCall({
    runtime: createTestRuntimeContext({
      identity: {
        userId: "user-1",
        sessionId: "session-1",
        parentSessionId: "parent-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
        caller: SESSION_CALLER.USER,
      },
    }),
    call: { id: "call_identity", name: "demo_tool", args: {} },
    tool: {
      invoke: async () => {
        const error = new Error("identity failure");
        error.code = "RECOVERABLE_IDENTITY_FAILURE";
        throw error;
      },
    },
    identity: {
      userId: "user-1",
      sessionId: "session-1",
      rootSessionId: "parent-1",
      parentSessionId: "parent-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      runId: "agent:turn-1",
      presentationMessageId: "message-call_identity",
    },
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
