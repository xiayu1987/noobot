/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";

import { processToolResults } from "../../../src/runtime/turn/response-processor.js";
import { settleToolCallInTurn } from "../../../src/runtime/tool-execution/tool-runner.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

function createRuntime() {
  const runtime = {
    userId: "admin",
    basePath: os.tmpdir(),
    globalConfig: { workspaceRoot: os.tmpdir() },
    runConfig: {
      executionId: "run-tool-batch",
      turnScopeId: "turn-tool-batch",
    },
    systemRuntime: {
      userId: "admin",
      sessionId: "session-tool-batch",
      rootSessionId: "session-tool-batch",
      dialogProcessId: "dialog-tool-batch",
      turnScopeId: "turn-tool-batch",
      messageEventStream: { sequence: 0 },
    },
    sessionManager: createCanonicalMessageEventSessionManager(),
  };
  bindAssistantMessageEventStream(runtime, {
    messageId: "message-tool-batch",
    presentationMessageId: "presentation-tool-batch",
  });
  return runtime;
}

test("processToolResults commits every settled parallel result before propagating user stop", async () => {
  const runtime = createRuntime();
  const stopReason = { type: "user_stop", reason: "user stop action" };
  const calls = [
    { id: "call-read", name: "read_file", args: {} },
    { id: "call-script", name: "execute_script", args: {} },
    { id: "call-parse", name: "multimodal_parse", args: {} },
    { id: "call-native", name: "execute_native_script", args: {} },
  ];
  const toolMap = new Map([
    [
      "read_file",
      {
        async invoke() {
          await wait(20);
          return { ok: true, value: "read" };
        },
      },
    ],
    [
      "execute_script",
      {
        async invoke() {
          await wait(30);
          return { ok: true, value: "script" };
        },
      },
    ],
    [
      "multimodal_parse",
      {
        async invoke() {
          await wait(5);
          throw stopReason;
        },
      },
    ],
    [
      "execute_native_script",
      {
        async invoke() {
          await wait(10);
          return { ok: true, value: "native" };
        },
      },
    ],
  ]);
  const committed = [];
  const modelState = {
    runtime,
    abortSignal: null,
    eventListener: () => {},
  };
  modelState.agentContext = createTestAgentExecutionScope(runtime);

  await assert.rejects(
    processToolResults({
      modelState,
      loopState: { errorLogger: null, toolConsecutiveFailureCount: 0 },
      turn: 1,
      calls,
      toolMap,
      stateCommitter: {
        async pushToolResult(result) {
          committed.push(result);
        },
      },
    }),
    (error) => error === stopReason,
  );

  assert.deepEqual(
    committed.map((entry) => entry.call.id),
    calls.map((call) => call.id),
  );
  assert.equal(committed.length, 4);
  assert.equal(JSON.parse(committed[0].toolResultText).ok, true);
  assert.equal(JSON.parse(committed[1].toolResultText).ok, true);
  assert.deepEqual(JSON.parse(committed[2].toolResultText), {
    toolName: "multimodal_parse",
    ok: false,
    status: "aborted",
    error: "user stop action",
    code: "RECOVERABLE_USER_CANCELLED",
    stopType: "user_stop",
  });
  assert.equal(JSON.parse(committed[3].toolResultText).ok, true);
});

test("settleToolCallInTurn pairs a pre-existing stop without invoking the tool", async () => {
  const runtime = createRuntime();
  const abortController = new AbortController();
  abortController.abort({ type: "user_stop", reason: "user stop action" });
  let invocationCount = 0;

  const settlement = await settleToolCallInTurn({
    call: { id: "call-pre-stopped", name: "execute_script", args: {} },
    tool: {
      async invoke() {
        invocationCount += 1;
        return { ok: true };
      },
    },
    abortSignal: abortController.signal,
    eventListener: () => {},
    turn: 1,
    runtime,
  });

  assert.equal(invocationCount, 0);
  assert.equal(settlement.status, "rejected");
  assert.deepEqual(JSON.parse(settlement.result.toolResultText), {
    toolName: "execute_script",
    ok: false,
    status: "aborted",
    error: "user stop action",
    code: "RECOVERABLE_USER_CANCELLED",
    stopType: "user_stop",
  });
});
