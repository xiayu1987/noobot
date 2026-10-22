/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import test from "node:test";
import assert from "node:assert/strict";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/session-protocol/message-identity";

import {
  invokeNoToolsTurn as invokeNoToolsTurnProduction,
  invokeWithToolsTurn as invokeWithToolsTurnProduction,
} from "../../../src/runtime/turn/turn-executor.js";
import {
  createTestModelPort,
  createLoopTurnIdentity,
  prepareTestTurnExecution,
} from "./turn-runtime-test-helper.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

const TEST_MODEL_SPEC = Object.freeze(
  normalizeRuntimeModelSpec({
    model: "gpt-4o",
    reasoning_effort: "medium",
    tool_reasoning_effort: "medium",
    reasoning_effort_options: ["low", "medium", "high"],
    reasoning_effort_parameter: "reasoning_effort",
  }),
);

function contextMessage(native = {}, metadata = {}) {
  return writeContextMessageMetadata(
    { ...native },
    { messageUid: createMessageUid(), ...metadata },
  );
}

function invokeNoToolsTurn(args = {}) {
  prepareTestTurnExecution(
    args.modelState,
    args.loopState,
    createLoopTurnIdentity(args.loopState),
    "presentation-message-filter-cases-c",
  );
  return invokeNoToolsTurnProduction(args);
}

function invokeWithToolsTurn(args = {}) {
  prepareTestTurnExecution(
    args.modelState,
    args.loopState,
    createLoopTurnIdentity(args.loopState),
    "presentation-message-filter-cases-c",
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
    runtime: createTestRuntimeContext({
      sessionManager: createCanonicalMessageEventSessionManager(),
      runConfig: { hookManager: null, streaming: false },
    }),
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [contextMessage({ role: "user", content: "keep-user" })],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    dialogProcessId: "d-stream-disabled",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok-without-final-stream");
  const streamedEventTypes = events
    .map((item) => item?.data?.envelope?.payload?.eventType || item?.event)
    .filter((eventType) => eventType === "llm_delta" || eventType === "activity_delta");
  assert.deepEqual(streamedEventTypes, []);
});

test("invokeNoToolsTurn consumes only the final ModelPort result", async () => {
  const modelState = {
    modelPort: {
      async invoke() {
        return { output: { text: "ok after retry", toolCalls: [] } };
      },
    },
    runtime: createTestRuntimeContext({
      sessionManager: createCanonicalMessageEventSessionManager(),
    }),
    eventListener: null,
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [contextMessage({ role: "user", content: "go" })],
    },
    traces: [],
    dialogProcessId: "d-reasoning-no-tools",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.output, "ok after retry");
  const providerRetryPrompt =
    modelState.runtime.activeMessageContext.messageBlocks.incremental.find((message) =>
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
    runtime: createTestRuntimeContext({
      sessionManager: createCanonicalMessageEventSessionManager(),
      runConfig: { hookManager: null, streaming: false },
    }),
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: null,
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [contextMessage({ role: "user", content: "go" })],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    dialogProcessId: "d-reasoning-tools",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok with tools after retry");
  const providerRetryPrompt =
    modelState.runtime.activeMessageContext.messageBlocks.incremental.find((message) =>
      String(message?.content || "").includes("thinking with tools"),
    );
  assert.equal(providerRetryPrompt, undefined);
});
