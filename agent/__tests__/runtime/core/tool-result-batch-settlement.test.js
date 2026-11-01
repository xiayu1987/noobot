/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initializeCurrentTurnMessageEventProjection } from "../../../src/events/current-turn-message-event-projection.js";
import { fatalSystemError } from "../../../src/shared/errors/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { processToolResults } from "../../../src/runtime/turn/response-processor.js";
import {
  startToolCallInTurn,
  settleStartedToolCallInTurn,
} from "../../../src/runtime/tool-execution/tool-runner.js";
import { bindCurrentTurnPersistence } from "../../../src/bot/execution/runner/current-turn-persistence.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { AttachmentService } from "../../../src/artifacts/service/attachment-service.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { bindTestDispatchLifecycle } from "./turn-runtime-test-helper.js";
import { findCommittedMessagePayload } from "./tool-runner.test-helpers.js";

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
const settleToolCallInTurn = async (options) =>
  settleStartedToolCallInTurn(await startToolCallInTurn(options));

test("parallel starts persist before invocation and ends/results flush once before fatal propagation", async () => {
  const runtime = createRuntime();
  runtime.currentTurnMessages.replaceAll([
    { messageUid: "owner", role: "assistant", content: "running" },
  ]);
  const persisted = [];
  const facts = [];
  const commitMessageEvent = runtime.sessionManager.commitMessageEvent;
  runtime.sessionManager.commitMessageEvent = async (request) => {
    const result = await commitMessageEvent(request);
    facts.push(request.payload.eventType);
    return result;
  };
  runtime.projectCurrentTurnMessageEvent = async () => {
    runtime.currentTurnMessages.replaceAll([
      { messageUid: "owner", role: "assistant", content: facts.join(",") },
    ]);
    await runtime.persistCurrentTurnMessages();
  };
  const checkpointFile = path.join(workspaceRoot, "start-checkpoint.json");
  bindCurrentTurnPersistence({
    dispatchRuntime: runtime,
    appendAgentMessages: async ({ messages }) => {
      persisted.push(messages);
      fs.writeFileSync(checkpointFile, JSON.stringify(messages));
      return messages;
    },
  });
  const fatalError = fatalSystemError("fatal", { code: "FATAL_TEST" });
  await assert.rejects(
    processToolResults({
      modelState: { runtime, agentContext: createTestAgentExecutionScope(runtime) },
      loopState: { errorLogger: null },
      turn: 1,
      calls: [
        { id: "ok", name: "read_file", args: {} },
        { id: "fatal", name: "execute_script", args: {} },
      ],
      toolMap: new Map([
        [
          "read_file",
          {
            async invoke() {
              assert.equal(persisted.length, 1);
              assert.ok(facts.includes("tool_call_start"));
              const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
              assert.equal(checkpoint[0].content, "tool_call_start,tool_call_start");
              return { ok: true };
            },
          },
        ],
        [
          "execute_script",
          {
            async invoke() {
              throw fatalError;
            },
          },
        ],
      ]),
      stateCommitter: {
        async pushToolResult() {
          await runtime.persistCurrentTurnMessages();
        },
      },
    }),
    (error) => error === fatalError,
  );
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0][0].content, "tool_call_start,tool_call_start");
  assert.equal(
    persisted[1][0].content,
    "tool_call_start,tool_call_start,tool_call_end,tool_call_end",
  );
  assert.equal(facts.filter((type) => type === "tool_call_start").length, 2);
  assert.equal(facts.filter((type) => type === "tool_call_end").length, 2);
});

test("settled timing separates invocation from event commit and includes the final commit", async () => {
  const runtime = createRuntime();
  const events = [];
  runtime.eventListener = { onEvent: (event) => events.push(event) };
  const commitMessageEvent = runtime.sessionManager.commitMessageEvent;
  runtime.sessionManager.commitMessageEvent = async (request) => {
    await wait(15);
    return commitMessageEvent(request);
  };
  const settled = await settleToolCallInTurn({
    call: { id: "timed", name: "read_file", args: {} },
    tool: {
      async invoke() {
        await wait(10);
        return { ok: true };
      },
    },
    turn: 1,
    runtime,
    agentContext: createTestAgentExecutionScope(runtime),
    abortSignal: runtime.abortSignal,
  });
  const timing = events.find((event) => event.event === "tool_call_timing");
  const { executionMs, frameworkMs } = timing.data;
  assert.ok(executionMs >= 5);
  assert.ok(frameworkMs >= 25, "both durable event commits belong to framework time");
  const end = findCommittedMessagePayload(events, "tool_call_end");
  assert.equal(settled.result.durationMs, end.durationMs);
  assert.ok(executionMs + frameworkMs >= end.durationMs + 10);
  for (const object of [end, settled.result]) {
    assert.equal(Object.hasOwn(object, "executionMs"), false);
    assert.equal(Object.hasOwn(object, "frameworkMs"), false);
  }
  assert.equal(Object.hasOwn(timing.data, "durationMs"), false);
});

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-tool-batch-"));
test.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

test("start persistence failure prevents invocation and is not recast as a tool end", async () => {
  const runtime = createRuntime();
  const failure = new Error("start persistence failed");
  const eventTypes = [];
  runtime.sessionManager.commitMessageEvent = async ({ payload }) => {
    eventTypes.push(payload.eventType);
    throw failure;
  };
  let invoked = false;
  await assert.rejects(
    settleToolCallInTurn({
      call: { id: "start-failure", name: "read_file", args: {} },
      abortSignal: runtime.abortSignal,
      tool: {
        async invoke() {
          invoked = true;
        },
      },
      runtime,
      turn: 1,
      agentContext: createTestAgentExecutionScope(runtime),
    }),
    (error) => error === failure,
  );
  assert.equal(invoked, false);
  assert.deepEqual(eventTypes, ["tool_call_start"]);
});

for (const eventType of ["tool_call_end", "tool_call_timing"]) {
  test(`${eventType} failure preserves the original fatal error without retrying end`, async () => {
    const runtime = createRuntime();
    const fatalError = fatalSystemError("fatal invocation", { code: "FATAL_TEST" });
    const emissionError = new Error("event emission failed");
    const commit = runtime.sessionManager.commitMessageEvent;
    let endAttempts = 0;
    runtime.sessionManager.commitMessageEvent = async (request) => {
      if (request.payload.eventType === "tool_call_end") {
        endAttempts += 1;
        if (eventType === "tool_call_end") throw emissionError;
      }
      return commit(request);
    };
    runtime.eventListener = {
      onEvent(event) {
        if (event.event === eventType) throw emissionError;
      },
    };
    await assert.rejects(
      settleToolCallInTurn({
        call: { id: `failure-${eventType}`, name: "execute_script", args: {} },
        abortSignal: runtime.abortSignal,
        tool: {
          async invoke() {
            throw fatalError;
          },
        },
        runtime,
        turn: 1,
        agentContext: createTestAgentExecutionScope(runtime),
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [fatalError, emissionError]);
        return true;
      },
    );
    assert.equal(endAttempts, 1);
  });
}

test("timing emission failure after success propagates without a second end", async () => {
  const runtime = createRuntime();
  const failure = new Error("timing failed");
  let endCount = 0;
  runtime.eventListener = {
    onEvent(event) {
      if (event.data?.envelope?.payload.eventType === "tool_call_end") endCount += 1;
      if (event.event === "tool_call_timing") return Promise.reject(failure);
    },
  };
  await assert.rejects(
    settleToolCallInTurn({
      call: { id: "timing-failure", name: "read_file", args: {} },
      abortSignal: runtime.abortSignal,
      tool: {
        async invoke() {
          return { ok: true };
        },
      },
      runtime,
      turn: 1,
      agentContext: createTestAgentExecutionScope(runtime),
    }),
    (error) => error === failure,
  );
  assert.equal(endCount, 1);
});

test("a failed parallel settlement drains peers and persists their results before propagating", async () => {
  const runtime = createRuntime();
  const failure = new Error("timing failed");
  const fatalError = fatalSystemError("parallel fatal invocation", { code: "FATAL_TEST" });
  let slowCompleted = false;
  const committed = [];
  const order = [];
  runtime.eventListener = {
    onEvent(event) {
      if (event.event === "tool_call_timing" && event.data.toolCallId === "fast") throw failure;
    },
  };
  runtime.withCurrentTurnPersistenceBatch = async (operation) => {
    const result = await operation();
    order.push("flushed");
    return result;
  };
  await assert.rejects(
    processToolResults({
      modelState: { runtime, agentContext: createTestAgentExecutionScope(runtime) },
      loopState: { errorLogger: null },
      turn: 1,
      calls: [
        { id: "fast", name: "read_file", args: {} },
        { id: "slow", name: "execute_script", args: {} },
        { id: "fatal-peer", name: "multimodal_parse", args: {} },
      ],
      toolMap: new Map([
        [
          "multimodal_parse",
          {
            async invoke() {
              throw fatalError;
            },
          },
        ],
        [
          "read_file",
          {
            async invoke() {
              return { ok: true };
            },
          },
        ],
        [
          "execute_script",
          {
            async invoke() {
              await wait(20);
              slowCompleted = true;
              return { ok: true };
            },
          },
        ],
      ]),
      stateCommitter: {
        async pushToolResult(result) {
          committed.push(result.call.id);
          order.push("result");
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, fatalError]);
      return true;
    },
  );
  assert.equal(slowCompleted, true);
  assert.deepEqual(committed, ["slow", "fatal-peer"]);
  assert.deepEqual(order, ["flushed", "result", "result", "flushed"]);
});

function createRuntime(abortSignal = new AbortController().signal) {
  const runtime = createTestRuntimeContext({
    abortSignal,
    basePath: workspaceRoot,
    globalConfig: { workspaceRoot },
    attachmentService: new AttachmentService({ workspaceRoot }),
    sessionManager: createCanonicalMessageEventSessionManager(),
    runConfig: {
      hookManager: null,
      executionId: "run-tool-batch",
      turnScopeId: "turn-tool-batch",
      presentationMessageId: "presentation-tool-batch",
    },
    identity: {
      userId: "admin",
      sessionId: "session-tool-batch",
      dialogProcessId: "dialog-tool-batch",
    },
    systemRuntime: {},
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "presentation-tool-batch",
    parentSessionId: "",
    workflowNodeOwnership: null,
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  return bindTestDispatchLifecycle(runtime);
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
  };
  modelState.agentContext = createTestAgentExecutionScope(runtime);

  await assert.rejects(
    processToolResults({
      modelState,
      loopState: { errorLogger: null },
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
    agentContext: createTestAgentExecutionScope(runtime),
  };
  await processToolResults({
    modelState,
    loopState: { errorLogger: null },
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
  const loopState = { errorLogger: null };
  const modelState = {
    runtime,
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
    const result = await operation();
    order.push("batch:persisted");
    return result;
  };
  runtime.consumeUserInterjections = async () => {
    order.push("interjections:consumed");
  };
  await processToolResults({
    modelState: {
      runtime,
      eventListener: null,
      agentContext: createTestAgentExecutionScope(runtime),
    },
    loopState: { errorLogger: null },
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
    "batch:persisted",
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
    eventListener: null,
    turn: 1,
    runtime,
    abortSignal: abortController.signal,
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

test("settleToolCallInTurn rejected fatal path reports elapsed durationMs on tool_call_end", async () => {
  const runtime = createRuntime();
  const events = [];
  runtime.eventListener = { onEvent: (event) => events.push(event) };
  const fatalError = fatalSystemError("fatal tool failure", { code: "FATAL_TEST" });
  let invokedAt;
  let failedAt;

  const settlement = await settleToolCallInTurn({
    call: { id: "call-fatal", name: "execute_script", args: {} },
    tool: {
      async invoke() {
        invokedAt = Date.now();
        await wait(20);
        failedAt = Date.now();
        throw fatalError;
      },
    },
    executionScope: "primary",
    turn: 1,
    runtime,
    agentContext: createTestAgentExecutionScope(runtime),
    abortSignal: runtime.abortSignal,
  });

  assert.equal(settlement.status, "rejected");
  assert.equal(settlement.error, fatalError);
  const toolCallEnd = findCommittedMessagePayload(events, "tool_call_end");
  assert.equal(toolCallEnd.success, false);
  assert.ok(Number.isFinite(toolCallEnd.durationMs));
  assert.ok(toolCallEnd.durationMs >= failedAt - invokedAt);
  assert.ok(toolCallEnd.durationMs > 0);
});
