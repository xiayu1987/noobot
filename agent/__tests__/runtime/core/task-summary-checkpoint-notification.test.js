/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { createModelContext } from "@noobot/context-protocol";
import {
  resolveContextMessageSummarized,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { bindTestDispatchLifecycle } from "./turn-runtime-test-helper.js";

function createSummaryRuntime(currentTurnMessages, commitSummaryCheckpoint) {
  const runtime = createTestRuntimeContext({
    runConfig: { hookManager: null, turnScopeId: "scope-1" },
    systemRuntime: { sessionId: "s1", turnScopeId: "scope-1", dialogProcessId: "dialog-1" },
  });
  runtime.currentTurnMessages = currentTurnMessages;
  runtime.commitSummaryCheckpoint = commitSummaryCheckpoint;
  return bindTestDispatchLifecycle(runtime);
}

function createSummaryModelState(runtime, incremental) {
  runtime.activeMessageContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental },
    activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
  });
  return {
    runtime,
    agentContext: createTestAgentExecutionScope(runtime, {
      identity: {
        sessionId: runtime.systemRuntime.sessionId,
        dialogProcessId: runtime.systemRuntime.dialogProcessId,
        turnScopeId: runtime.runConfig.turnScopeId,
        userId: "u-test",
        rootSessionId: "s1",
        parentSessionId: "",
        runId: "r-1",
        presentationMessageId: "m-1",
      },
    }),
  };
}

test("task_summary sends one checkpoint command without mutating messages before commit", async () => {
  const oldSystem = { role: "system", content: "old system" };
  const oldCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "old", function: { name: "read_file" } }],
  };
  const oldResult = { role: "tool", content: "old result", tool_call_id: "old" };
  const summaryCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "summary", function: { name: "task_summary" } }],
  };
  const summaryResult = {
    role: "tool",
    content: '{"toolName":"task_summary","ok":true}',
    tool_call_id: "summary",
    toolName: "task_summary",
  };
  const messages = [oldSystem, oldCall, oldResult, summaryCall, summaryResult];

  const records = messages.map((message, index) => ({
    ...structuredClone(message),
    messageUid: `sm_${index + 1}`,
    dialogProcessId: "dialog-1",
    turnScopeId: "scope-1",
  }));

  const contextMessages = records.map(
    ({ messageUid, dialogProcessId, turnScopeId, toolName, ...native }) =>
      writeContextMessageMetadata(native, { messageUid, dialogProcessId, turnScopeId, toolName }),
  );
  const currentTurnMessages = createCurrentTurnMessagesStore(records);
  const checkpointCalls = [];
  const runtime = createSummaryRuntime(currentTurnMessages, async (payload) => {
    checkpointCalls.push(payload);
    assert.equal(contextMessages.some(resolveContextMessageSummarized), false);
    assert.equal(
      currentTurnMessages.toArray().some((record) => record.summarized === true),
      false,
    );
    return { committed: true };
  });
  let invocation = 0;
  const run = createTurnOrchestrator({
    resolveLlmForTurnFn: () => {},
    assertNotAbortedFn: () => {},
    invokeWithToolsTurnFn: async () => {
      invocation += 1;
      if (invocation === 1) {
        return {
          aiContentText: "",
          calls: [{ id: "summary", name: "task_summary", args: {} }],
          turnMessageStore: currentTurnMessages,
          turnTaskStore: { toArray: () => [] },
          stateCommitter: {},
        };
      }
      return {
        aiContentText: "done",
        calls: [],
        turnMessageStore: currentTurnMessages,
        turnTaskStore: { toArray: () => [] },
      };
    },
    processToolResultsFn: async () => ({
      toolCallResults: [],
      taskSummaryOutcome: { attempted: true, accepted: true },
    }),
    buildLoopResultFn: ({ output }) => ({ output }),
    maybeRequestPhaseSummaryFn: () => {},
    maybePromptHelpToolByLoopFn: () => {},
    maybePromptHelpToolByFailureFn: () => {},
  });

  const result = await run({
    modelState: createSummaryModelState(runtime, contextMessages),
    loopState: {
      tools: [{}],
      traces: [],
      maxTurns: 10,
      turnMessages: currentTurnMessages.toArray(),
      turnTasks: [],
    },
    turn: 1,
  });

  assert.equal(result.output, "done");
  assert.equal(checkpointCalls.length, 1);
  assert.equal(checkpointCalls[0].summaryCompletion.source, "task_summary");
  assert.deepEqual(
    new Set(checkpointCalls[0].summaryCompletion.summarizedMessageUids),
    new Set(["sm_1", "sm_2", "sm_3", "sm_4", "sm_5"]),
  );
});

test("rejected task_summary does not request a checkpoint", async () => {
  const currentTurnMessages = createCurrentTurnMessagesStore([]);
  const checkpointCalls = [];
  const runtime = createSummaryRuntime(currentTurnMessages, async (payload) => {
    checkpointCalls.push(payload);
    return { committed: true };
  });
  let invocation = 0;
  const run = createTurnOrchestrator({
    resolveLlmForTurnFn: () => {},
    assertNotAbortedFn: () => {},
    invokeWithToolsTurnFn: async () => {
      invocation += 1;
      return invocation === 1
        ? {
            aiContentText: "",
            calls: [{ id: "summary", name: "task_summary", args: {} }],
            turnMessageStore: currentTurnMessages,
            turnTaskStore: { toArray: () => [] },
            stateCommitter: {},
          }
        : {
            aiContentText: "done",
            calls: [],
            turnMessageStore: currentTurnMessages,
            turnTaskStore: { toArray: () => [] },
          };
    },
    processToolResultsFn: async () => ({
      toolCallResults: [{ call: { name: "task_summary" }, success: false }],
      taskSummaryOutcome: { attempted: true, accepted: false },
    }),
    buildLoopResultFn: ({ output }) => ({ output }),
    maybeRequestPhaseSummaryFn: () => {},
    maybeRequestTaskCheckFn: () => {},
    maybePromptHelpToolByLoopFn: () => {},
    maybePromptHelpToolByFailureFn: () => {},
  });

  const result = await run({
    modelState: createSummaryModelState(runtime, []),
    loopState: {
      tools: [{}],
      traces: [],
      maxTurns: 10,
      turnMessages: [],
      turnTasks: [],
    },
    turn: 1,
  });

  assert.equal(result.output, "done");
  assert.deepEqual(checkpointCalls, []);
});
