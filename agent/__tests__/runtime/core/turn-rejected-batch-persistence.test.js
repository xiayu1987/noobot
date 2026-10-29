/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import { createModelContext } from "@noobot/context-protocol";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";

import { invokeWithToolsTurn } from "../../../src/runtime/turn/turn-executor.js";
import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import { materializeStoppedAssistantDraft } from "../../../src/runtime/tool-execution/stopped-assistant-draft.js";
import { currentAssistantDraft } from "../../../src/events/message-event-stream.js";
import { DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS } from "../../../src/runtime/constants/index.js";
import { createTestModelPort, prepareTestTurnExecution } from "./turn-runtime-test-helper.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
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

async function invokeMixedControlBatch({ hookManager = null } = {}) {
  const llm = {
    bindTools() {
      return {
        async invoke() {
          return {
            content: "checking",
            tool_calls: [
              { id: "c1", name: "task_check", args: {} },
              { id: "c2", name: "execute_script", args: {} },
            ],
          };
        },
      };
    },
  };
  const runtime = createTestRuntimeContext({
    sessionManager: createCanonicalMessageEventSessionManager(),
    runConfig: { hookManager },
  });
  let persisted = 0;
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: { system: [], history: [], incremental: [] },
    traces: [],
    tools: [{ name: "task_check" }, { name: "execute_script" }],
    maxTurns: 10,
  };
  prepareTestTurnExecution(modelState, loopState, "presentation-rejected-batch");
  runtime.persistCurrentTurnMessages = async () => {
    persisted += 1;
  };
  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });
  return { result, runtime, persisted: () => persisted };
}

test("a control tool mixed batch is rejected before entering context or Session", async () => {
  const { result, runtime, persisted } = await invokeMixedControlBatch();

  assert.deepEqual(result.rejectedControlToolBatch, {
    controlToolName: "task_check",
    toolCallCount: 2,
  });
  assert.equal(result.stateCommitter, undefined);
  assert.equal(persisted(), 0);
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
  assert.equal(runtime.activeMessageContext.messages.length, 0);
});

test("a rejected batch never reaches AFTER_LLM_CALL plugins", async () => {
  const hookManager = createHookManager();
  const points = [];
  for (const point of [HOOK_POINT.AGENT.BEFORE_LLM_CALL, HOOK_POINT.AGENT.AFTER_LLM_CALL]) {
    hookManager.on(point, async () => points.push(point), { id: `test.${point}` });
  }

  const { result } = await invokeMixedControlBatch({ hookManager });

  assert.equal(result.rejectedControlToolBatch.controlToolName, "task_check");
  assert.deepEqual(points, [HOOK_POINT.AGENT.BEFORE_LLM_CALL]);
});

test("a stop after a rejected batch does not materialize the discarded draft", async () => {
  const { runtime, persisted } = await invokeMixedControlBatch();

  assert.equal(currentAssistantDraft(runtime), null);
  assert.equal(await materializeStoppedAssistantDraft(runtime), null);
  assert.equal(persisted(), 0);
  assert.equal(runtime.currentTurnMessages.toArray().length, 0);
});

function createOrchestratorHarness() {
  const runtime = createTestRuntimeContext({
    identity: { sessionId: "session-1", turnScopeId: "scope-1" },
    systemRuntime: {},
    sealUserInterjectionQueueIfEmpty: () => true,
    consumeUserInterjections: async () => [],
  });
  runtime.activeMessageContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
    activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
  });
  const calls = { withTools: [], noTools: [] };
  const events = [];
  runtime.eventListener = { onEvent: (event) => events.push(event) };
  const turnStore = { toArray: () => [] };
  const run = createTurnOrchestrator({
    resolveLlmForTurnFn: () => {},
    assertNotAbortedFn: () => {},
    invokeWithToolsTurnFn: async ({ turn }) => {
      calls.withTools.push(turn);
      if (calls.withTools.length === 1) {
        return {
          rejectedControlToolBatch: { controlToolName: "task_summary", toolCallCount: 2 },
        };
      }
      return {
        aiContentText: "done",
        modelMessageId: "m-final",
        calls: [],
        turnMessageStore: turnStore,
      };
    },
    invokeNoToolsTurnFn: async ({ turn }) => {
      calls.noTools.push(turn);
      return { output: "finalized", turnMessageStore: turnStore };
    },
    buildLoopResultFn: ({ output }) => ({ output }),
    maybeRequestPhaseSummaryFn: () => {},
    maybeRequestTaskCheckFn: () => {},
    maybePromptHelpToolByLoopFn: () => {},
    maybePromptHelpToolByFailureFn: () => {},
  });
  const runLoop = (loopState, turn) =>
    run({
      modelState: { runtime, agentContext: createTestAgentExecutionScope(runtime) },
      loopState: { tools: [{}], traces: [], dialogProcessId: "dialog-1", ...loopState },
      turn,
    });
  return { runtime, calls, runLoop };
}

test("a rejected control batch retries with the single tool prompt", async () => {
  const { runtime, calls, runLoop } = createOrchestratorHarness();

  const result = await runLoop({ maxTurns: 10 }, 1);

  assert.equal(result.output, "done");
  assert.deepEqual(calls.withTools, [1, 2]);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map((message) => message.injectedMessageType),
    [CONTEXT_INJECTED_MESSAGE_TYPE.TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT],
  );
});

test("crossing the loop buffer finalizes without another tools call", async () => {
  const { calls, runLoop } = createOrchestratorHarness();
  const maxTurns = 3;
  const turn = maxTurns + DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS + 1;

  const result = await runLoop({ maxTurns }, turn);

  assert.equal(result.output, "finalized");
  assert.deepEqual(calls.withTools, []);
  assert.deepEqual(calls.noTools, [turn]);
});
