/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendContextMessage,
  createModelContext,
  writeMessageBlocks,
} from "@noobot/context-protocol";
import { createEmptyHookResult } from "@noobot/hook-protocol";

import {
  invokeNoToolsTurn as invokeNoToolsTurnProduction,
  invokeWithToolsTurn as invokeWithToolsTurnProduction,
} from "../../../src/runtime/turn/turn-executor.js";
import { requestMainFlowSummaryCheckpoint } from "../../../src/runtime/main-flow-control.js";
import { createTestModelPort, prepareTestTurnExecution } from "./turn-runtime-test-helper.js";

const TEST_MODEL_SPEC = Object.freeze({
  model: "gpt-4o",
  reasoning_effort: "medium",
  tool_reasoning_effort: "medium",
  reasoning_effort_options: ["low", "medium", "high"],
  reasoning_effort_parameter: "reasoning_effort",
});

function invokeNoToolsTurn(args = {}) {
  prepareTestTurnExecution(
    args.modelState,
    args.loopState,
    `no-tools-${args.loopState?.dialogProcessId || "turn"}`,
  );
  return invokeNoToolsTurnProduction(args);
}

function invokeWithToolsTurn(args = {}) {
  prepareTestTurnExecution(
    args.modelState,
    args.loopState,
    `with-tools-${args.loopState?.dialogProcessId || "turn"}`,
  );
  return invokeWithToolsTurnProduction(args);
}

test("invokeNoToolsTurn filters only summarized messages before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    async invoke(messages) {
      capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
      return { content: "ok" };
    },
  };

  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
      },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1" },
      { role: "assistant", content: "summarized", summarized: true },
      { role: "user", content: "keep-user" },
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
        },
        { role: "tool", content: '{"ok":true}', tool_call_id: "c1" },
        { role: "assistant", content: "summarized", summarized: true },
        { role: "user", content: "keep-user" },
      ],
    },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d1",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: '{"ok":true}' },
      { role: "user", content: "keep-user" },
    ],
  );
  assert.equal(result.output, "ok");
  const finalResponse = loopState.modelContext.messages.at(-1);
  assert.equal(finalResponse.content, "ok");
  assert.equal(loopState.modelContext.messageBlocks.incremental.at(-1), finalResponse);
});


test("invokeWithToolsTurn filters only summarized messages before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
          return {
            content: "ok-with-tools",
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
      },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
      { role: "assistant", content: "drop-summarized", summarized: true },
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", function: { name: "execute_script" } }],
        },
        { role: "tool", content: '{"ok":true}', tool_call_id: "c1" },
        { role: "assistant", content: "keep-assistant" },
        { role: "user", content: "keep-user" },
        { role: "assistant", content: "drop-summarized", summarized: true },
      ],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d2",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });
  assert.equal(result.aiContentText, "ok-with-tools");
  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: '{"ok":true}' },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
    ],
  );
  const finalAssistant = loopState.modelContext.messages.at(-1);
  assert.equal(finalAssistant.content, "ok-with-tools");
  assert.equal(loopState.modelContext.messageBlocks.incremental.at(-1), finalAssistant);
});


test("invokeWithToolsTurn sends system history incremental order after before_llm_call hooks", async () => {
  let capturedMessages = [];
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "agent.before_llm_call") return createEmptyHookResult(point, ctx);
        // A detached flat projection is not a writable context source. The
        // authoritative blocks remain unchanged.
        return createEmptyHookResult(point, ctx);
      },
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const system = { role: "system", content: "sys" };
  const history = { role: "assistant", content: "hist", dialogProcessId: "d-old" };
  const incremental = { role: "user", content: "current", dialogProcessId: "d-current" };
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [system, history, incremental],
    messageBlocks: {
      system: [system],
      history: [history],
      incremental: [incremental],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-current",
    maxTurns: 1,
  };
  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => `${item.role}:${item.content}`),
    ["system:sys", "assistant:hist", "user:current"],
  );
});


test("invokeWithToolsTurn sends a before_llm analysis relay appended by the hook", async () => {
  let capturedMessages = [];
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "agent.before_llm_call") return createEmptyHookResult(point, ctx);
        appendContextMessage(
          ctx.modelContext,
          {
            role: "user",
            content: "[来自harness外部模型输出/guidance]\\n分析结果",
            injectedMessage: true,
            injectedBy: "harness-plugin",
            injectedMessageType: "separate_model_relay:guidance",
            purpose: "guidance",
            pluginFlow: "analysis",
            chain: "auxiliary",
          },
          { block: "incremental" },
        );
        return createEmptyHookResult(point, ctx);
      },
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = messages;
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };
  const current = { role: "user", content: "current-user", dialogProcessId: "d-current" };
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [current],
    messageBlocks: { system: [], history: [], incremental: [current] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-current",
    maxTurns: 1,
  };

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  const relay = capturedMessages.find((item = {}) => item?.injectedMessageType);
  assert.equal(relay?.role, "user");
  assert.equal(relay?.pluginFlow, "analysis");
  assert.equal(relay?.chain, "auxiliary");
  assert.match(String(relay?.content || ""), /分析结果/);
});


test("invokeWithToolsTurn commits a separate-model summary checkpoint before model projection", async () => {
  let capturedMessages = [];
  const current = { role: "user", content: "current-user" };
  const toolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-covered", function: { name: "execute_script" } }],
  };
  const toolResult = {
    role: "tool",
    content: "covered-result",
    tool_call_id: "call-covered",
  };
  const summary = { role: "user", content: "summary-relay" };
  let loopState = null;
  let checkpointCount = 0;
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "agent.before_llm_call") return createEmptyHookResult(point, ctx);
        writeMessageBlocks(ctx.modelContext, {
          incremental: [...ctx.modelContext.messageBlocks.incremental, summary],
        });
        requestMainFlowSummaryCheckpoint(runtime, {
          source: "plugin.summary",
          summarizedMessageIds: ["tool-call", "tool-result"],
        });
        return createEmptyHookResult(point, ctx);
      },
    },
    async commitSummaryCheckpoint() {
      checkpointCount += 1;
      writeMessageBlocks(loopState.modelContext, {
        incremental: loopState.modelContext.messageBlocks.incremental.filter(
          (message) => message !== toolCall && message !== toolResult,
        ),
      });
      return { committed: true };
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = [...messages];
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  loopState = {
    messages: [current, toolCall, toolResult],
    messageBlocks: { system: [], history: [], incremental: [current, toolCall, toolResult] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-summary",
    maxTurns: 1,
  };

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(checkpointCount, 1);
  assert.deepEqual(
    capturedMessages.map((message) => `${message.role}:${message.content}`),
    ["user:current-user", "user:summary-relay"],
  );
});

