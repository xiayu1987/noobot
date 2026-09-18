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
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

function createRuntime(abortSignal = null) {
  const runtime = {
    abortSignal,
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

test("processToolResults commits result policy from its authoritative batch call", async () => {
  const runtime = createRuntime();
  const policy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  const committed = [];
  const modelState = {
    runtime,
    abortSignal: null,
    eventListener: () => {},
    agentContext: createTestAgentExecutionScope(runtime),
  };
  await processToolResults({
    modelState,
    loopState: { errorLogger: null, toolConsecutiveFailureCount: 0 },
    turn: 1,
    calls: [{ id: "check-1", name: "task_check", args: {}, contextPolicy: policy }],
    toolMap: new Map([
      [
        "task_check",
        {
          contextPolicy: policy,
          async invoke() {
            return { ok: true };
          },
        },
      ],
    ]),
    stateCommitter: {
      async pushToolResult(result) {
        committed.push(result);
      },
    },
  });
  assert.deepEqual(committed[0].call.contextPolicy, policy);
});

test("processToolResults accepts only a successful task_summary result", async () => {
  const runtime = createRuntime();
  const committed = [];
  const loopState = { errorLogger: null, toolConsecutiveFailureCount: 0 };
  const modelState = {
    runtime,
    abortSignal: null,
    eventListener: () => {},
    agentContext: createTestAgentExecutionScope(runtime),
  };
  const stateCommitter = {
    async pushToolResult(result) {
      committed.push(result);
    },
  };

  const rejected = await processToolResults({
    modelState,
    loopState,
    turn: 1,
    calls: [
      {
        id: "summary-rejected",
        name: "task_summary",
        args: { summaryContent: "invalid summary" },
      },
    ],
    toolMap: new Map([
      [
        "task_summary",
        {
          async invoke() {
            return { ok: false, code: "RECOVERABLE_INVALID_TOOL_INPUT" };
          },
        },
      ],
    ]),
    stateCommitter,
  });
  assert.deepEqual(rejected.taskSummaryOutcome, { attempted: true, accepted: false });
  assert.equal(loopState.taskSummaryTriggered, undefined);

  const accepted = await processToolResults({
    modelState,
    loopState,
    turn: 2,
    calls: [
      {
        id: "summary-accepted",
        name: "task_summary",
        args: { summaryContent: "valid summary" },
      },
    ],
    toolMap: new Map([
      [
        "task_summary",
        {
          async invoke() {
            return { ok: true };
          },
        },
      ],
    ]),
    stateCommitter,
  });
  assert.deepEqual(accepted.taskSummaryOutcome, { attempted: true, accepted: true });
  assert.equal(loopState.taskSummaryTriggered, true);
  assert.equal(committed.length, 2);
});

test("processToolResults consumes queued user interjections only after the tool batch persists", async () => {
  const runtime = createRuntime();
  const order = [];
  runtime.withCurrentTurnPersistenceBatch = async (operation) => {
    order.push("batch:start");
    await operation();
    order.push("batch:persisted");
  };
  runtime.consumeUserInterjections = async () => {
    order.push("interjections:consumed");
  };
  await processToolResults({
    modelState: {
      runtime,
      eventListener: () => {},
      agentContext: createTestAgentExecutionScope(runtime),
    },
    loopState: { errorLogger: null, toolConsecutiveFailureCount: 0 },
    turn: 1,
    calls: [{ id: "call-1", name: "read_file", args: {} }],
    toolMap: new Map([
      [
        "read_file",
        {
          async invoke() {
            return { ok: true };
          },
        },
      ],
    ]),
    stateCommitter: {
      async pushToolResult() {
        order.push("tool:committed");
      },
    },
  });
  assert.deepEqual(order, [
    "batch:start",
    "tool:committed",
    "batch:persisted",
    "interjections:consumed",
  ]);
});

test("settleToolCallInTurn pairs a pre-existing stop without invoking the tool", async () => {
  const abortController = new AbortController();
  abortController.abort({ type: "user_stop", reason: "user stop action" });
  const runtime = createRuntime(abortController.signal);
  let invocationCount = 0;

  const settlement = await settleToolCallInTurn({
    call: { id: "call-pre-stopped", name: "execute_script", args: {} },
    tool: {
      async invoke() {
        invocationCount += 1;
        return { ok: true };
      },
    },
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
