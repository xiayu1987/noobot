/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createModelContext } from "@noobot/context-protocol";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { ModelProtocolError, MODEL_ERROR_CODE } from "@noobot/model-protocol";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { NO_FINAL_RESPONSE_RETRY_POLICY } from "@noobot/context-protocol/policy/no-final-response-retry";
import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

function sessionContextMessage(record) {
  return projectSessionRecordToContextMessage({ messageUid: createMessageUid(), ...record });
}

const RETRY_TYPE = CONTEXT_INJECTED_MESSAGE_TYPE.NO_FINAL_RESPONSE_RETRY_PROMPT;

function emptyResponseError() {
  return new ModelProtocolError("empty response", {
    code: MODEL_ERROR_CODE.EMPTY_RESPONSE_RETRY_EXHAUSTED,
    details: { attemptCount: 2 },
  });
}

function reasoningOnlyError() {
  return new ModelProtocolError("reasoning only", {
    code: MODEL_ERROR_CODE.REASONING_RETRY_EXHAUSTED,
    details: { attemptCount: 2 },
  });
}

function createHarness({ emptyResponses = 0, failWith = null, script = null } = {}) {
  const modelContext = createModelContext({
    messageBlocks: {
      system: [],
      history: [],
      incremental: [sessionContextMessage({ role: "user", content: "question" })],
    },
    activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
  });
  const systemRuntime = { sessionId: "session-1", turnScopeId: "scope-1" };
  const events = [];
  const promptedListeners = [];
  const runtime = createTestRuntimeContext({
    systemRuntime,
    sealUserInterjectionQueueIfEmpty: () => true,
    consumeUserInterjections: async () => [],
    eventListener: {
      onEvent: (event) => {
        events.push(event);
        if (event?.event === "no_final_response_retry_prompted")
          promptedListeners.forEach((fn) => fn(event));
      },
    },
  });
  runtime.activeMessageContext = modelContext;
  const { currentTurnMessages } = runtime;
  const observedInputs = [];
  let invocation = 0;
  const run = createTurnOrchestrator({
    resolveLlmForTurnFn: () => {},
    assertNotAbortedFn: () => {},
    invokeWithToolsTurnFn: async () => {
      invocation += 1;
      observedInputs.push(modelContext.messages.map((message) => String(message.content)));
      if (failWith) throw failWith;
      const step = script
        ? script[invocation - 1]
        : invocation <= emptyResponses
          ? "empty"
          : "final";
      if (step === "empty") throw emptyResponseError();
      if (step === "reasoning") throw reasoningOnlyError();
      if (step === "tool") {
        return {
          aiContentText: "",
          calls: [{ id: `call-${invocation}`, name: "execute_script", args: {} }],
          turnMessageStore: currentTurnMessages,
          turnTaskStore: { toArray: () => [] },
          stateCommitter: {},
        };
      }
      return {
        aiContentText: "final answer",
        modelMessageId: `assistant-${invocation}`,
        calls: [],
        turnMessageStore: currentTurnMessages,
        turnTaskStore: { toArray: () => [] },
      };
    },
    processToolResultsFn: async () => ({ toolCallResults: [], taskSummaryOutcome: null }),
    buildLoopResultFn: ({ output }) => ({ output }),
    maybeRequestPhaseSummaryFn: () => {},
    maybeRequestTaskCheckFn: () => {},
    maybePromptHelpToolByLoopFn: () => {},
    maybePromptHelpToolByFailureFn: () => {},
    handleEngineErrorFn: ({ error }) => {
      throw error;
    },
  });
  const execute = () =>
    run({
      modelState: {
        runtime,
        agentContext: createTestAgentExecutionScope(runtime),
      },
      loopState: {
        tools: [{}],
        traces: [],
        maxTurns: 10,
        dialogProcessId: "dialog-1",
        turnMessages: [],
        turnTasks: [],
      },
    });
  const retryPrompts = () =>
    currentTurnMessages.toArray().filter((message) => message.injectedMessageType === RETRY_TYPE);
  return {
    execute,
    systemRuntime,
    observedInputs,
    retryPrompts,
    events,
    onPrompted: (fn) => promptedListeners.push(fn),
    invocations: () => invocation,
  };
}

test("empty responses inject persisted control prompts with turn-cumulative ordinals", async () => {
  const harness = createHarness({ emptyResponses: 2 });
  const result = await harness.execute();

  assert.equal(result.output, "final answer");
  assert.equal(harness.invocations(), 3);
  assert.equal(harness.systemRuntime.noFinalResponseRetryPromptCount, 2);
  assert.equal(harness.systemRuntime.noFinalResponseRetryConsecutiveCount, 0);
  const prompts = harness.retryPrompts();
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].content, /#1\b/);
  assert.match(prompts[1].content, /#2\b/);
  for (const prompt of prompts) {
    assert.equal(prompt.type, "context_control");
    assert.equal(prompt.role, "user");
    assert.equal(prompt.chatPresentation, false);
  }
});

test("each retry request keeps the previous input as an unchanged prefix and ends with the newest prompt", async () => {
  const harness = createHarness({ emptyResponses: 2 });
  await harness.execute();

  const [first, second, third] = harness.observedInputs;
  const prompts = harness.retryPrompts().map((message) => message.content);
  assert.deepEqual(first, ["question"]);
  assert.deepEqual(second, [...first, prompts[0]]);
  assert.deepEqual(third, [...second, prompts[1]]);
});

test("the ordinal continues from the counter restored into systemRuntime", async () => {
  const harness = createHarness({ emptyResponses: 1 });
  harness.systemRuntime.noFinalResponseRetryPromptCount = 1;
  await harness.execute();

  assert.equal(harness.systemRuntime.noFinalResponseRetryPromptCount, 2);
  assert.match(harness.retryPrompts()[0].content, /#2\b/);
});

test("the original error propagates after the consecutive prompt budget is exhausted", async () => {
  const max = NO_FINAL_RESPONSE_RETRY_POLICY.MAX_CONSECUTIVE_PROMPTS;
  const harness = createHarness({ emptyResponses: max + 5 });

  await assert.rejects(harness.execute(), (error) => {
    assert.equal(error.code, MODEL_ERROR_CODE.EMPTY_RESPONSE_RETRY_EXHAUSTED);
    return true;
  });
  assert.equal(harness.invocations(), max + 1);
  assert.equal(harness.retryPrompts().length, max);
  assert.equal(harness.systemRuntime.noFinalResponseRetryPromptCount, max);
  assert.equal(harness.systemRuntime.noFinalResponseRetryConsecutiveCount, max);
});

test("a successful call resets the consecutive budget while the ordinal keeps accumulating", async () => {
  const max = NO_FINAL_RESPONSE_RETRY_POLICY.MAX_CONSECUTIVE_PROMPTS;
  const script = [...Array(max).fill("empty"), "tool", ...Array(max).fill("empty"), "final"];
  const harness = createHarness({ script });
  const result = await harness.execute();

  assert.equal(result.output, "final answer");
  assert.equal(harness.invocations(), script.length);
  const prompts = harness.retryPrompts();
  assert.equal(prompts.length, max * 2);
  prompts.forEach((prompt, index) => assert.match(prompt.content, new RegExp(`#${index + 1}\\b`)));
  assert.equal(harness.systemRuntime.noFinalResponseRetryPromptCount, max * 2);
  assert.equal(harness.systemRuntime.noFinalResponseRetryConsecutiveCount, 0);
});

test("an empty response after a success retries again with the next ordinal", async () => {
  const consecutiveSeen = [];
  const harness = createHarness({ script: ["empty", "tool", "empty", "final"] });
  harness.onPrompted(() =>
    consecutiveSeen.push(harness.systemRuntime.noFinalResponseRetryConsecutiveCount),
  );
  const result = await harness.execute();

  assert.equal(result.output, "final answer");
  const prompts = harness.retryPrompts();
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].content, /#1\b/);
  assert.match(prompts[1].content, /#2\b/);
  assert.deepEqual(consecutiveSeen, [1, 1]);
});

test("reasoning-only and empty responses share one strategy, ordinal and consecutive budget", async () => {
  const max = NO_FINAL_RESPONSE_RETRY_POLICY.MAX_CONSECUTIVE_PROMPTS;
  const script = ["reasoning", "empty", "reasoning", "final"].slice(0, max).concat("final");
  const harness = createHarness({ script });
  const result = await harness.execute();

  assert.equal(result.output, "final answer");
  const prompts = harness.retryPrompts();
  assert.equal(prompts.length, max);
  prompts.forEach((prompt, index) => assert.match(prompt.content, new RegExp(`#${index + 1}\\b`)));
  assert.equal(harness.systemRuntime.noFinalResponseRetryConsecutiveCount, 0);

  const exhausted = createHarness({ script: Array(max + 1).fill("reasoning") });
  await assert.rejects(exhausted.execute(), (error) => {
    assert.equal(error.code, MODEL_ERROR_CODE.REASONING_RETRY_EXHAUSTED);
    return true;
  });
  assert.equal(exhausted.retryPrompts().length, max);
});

test("errors without a no-final-response code are not intercepted", async () => {
  const failure = new Error("provider unavailable");
  const harness = createHarness({ failWith: failure });

  await assert.rejects(harness.execute(), (error) => error === failure);
  assert.equal(harness.invocations(), 1);
  assert.equal(harness.retryPrompts().length, 0);
});
