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

test("invokeWithToolsTurn does not final-stream when runConfig disables streaming", async () => {
  const events = [];
  const llm = {
    bindTools() {
      return {
        async invoke() {
          return {
            content: "ok-without-final-stream",
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
    runtime: {
      runConfig: { streaming: false },
      systemRuntime: {
        sessionId: "child-session",
        dialogProcessId: "d-stream-disabled",
        turnScopeId: "workflow-node:stream-disabled",
      },
    },
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [{ role: "user", content: "keep-user" }],
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-stream-disabled",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok-without-final-stream");
  assert.equal(result.finalStreaming, null);
  assert.equal(
    events.some((item) => String(item?.event || "") === "llm_final_stream_start"),
    false,
  );
  assert.equal(
    events.some((item) => item?.event === "main_model_content"),
    false,
  );
});

test("invokeNoToolsTurn consumes only the final ModelPort result", async () => {
  const modelState = {
    modelPort: {
      async invoke() {
        return { output: { text: "ok after retry", toolCalls: [] } };
      },
    },
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [{ role: "user", content: "go" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "go" }] },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-reasoning-no-tools",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.output, "ok after retry");
  const providerRetryPrompt = loopState.modelContext.messageBlocks.incremental.find((message) =>
    String(message?.content || "").includes("thinking only"),
  );
  assert.equal(providerRetryPrompt, undefined);
});

test("invokeWithToolsTurn does not project provider retry attempts into context", async () => {
  const modelState = {
    modelPort: {
      async invoke() {
        return { output: { text: "ok with tools after retry", toolCalls: [] } };
      },
    },
    runtime: {
      runConfig: { streaming: false },
      systemRuntime: {},
    },
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [{ role: "user", content: "go" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "go" }] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-reasoning-tools",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok with tools after retry");
  const providerRetryPrompt = loopState.modelContext.messageBlocks.incremental.find((message) =>
    String(message?.content || "").includes("thinking with tools"),
  );
  assert.equal(providerRetryPrompt, undefined);
});
