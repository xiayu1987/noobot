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
  messages.forEach((message, index) => {
    message.messageUid = `sm_${index + 1}`;
    message.dialogProcessId = "dialog-1";
    message.turnScopeId = "scope-1";
    message.additional_kwargs = { noobotMessageId: message.messageUid };
  });
  const currentTurnMessages = createCurrentTurnMessagesStore(structuredClone(messages));
  const checkpointCalls = [];
  const runtime = {
    systemRuntime: { sessionId: "s1", turnScopeId: "scope-1", dialogProcessId: "dialog-1" },
    currentTurnMessages,
    async commitSummaryCheckpoint(payload) {
      checkpointCalls.push(payload);
      assert.equal(oldSystem.summarized, undefined);
      assert.equal(oldCall.summarized, undefined);
      assert.equal(oldResult.summarized, undefined);
      assert.equal(summaryCall.summarized, undefined);
      assert.equal(summaryResult.summarized, undefined);
      return { committed: true };
    },
  };
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
    modelState: { runtime, eventListener: null, abortSignal: null },
    loopState: {
      tools: [{}],
      traces: [],
      maxTurns: 10,
      modelContext: createModelContext({
        messageBlocks: { system: [], history: [], incremental: messages },
        activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
      }),
      turnMessages: currentTurnMessages.toArray(),
      turnTasks: [],
    },
    turn: 1,
  });

  assert.equal(result.output, "done");
  assert.equal(checkpointCalls.length, 1);
  assert.equal(checkpointCalls[0].summaryCompletion.source, "task_summary");
  assert.deepEqual(
    new Set(checkpointCalls[0].summaryCompletion.summarizedMessageIds),
    new Set(["sm_1", "sm_2", "sm_3", "sm_4", "sm_5"]),
  );
});

test("rejected task_summary does not request a checkpoint", async () => {
  const currentTurnMessages = createCurrentTurnMessagesStore([]);
  const checkpointCalls = [];
  const runtime = {
    systemRuntime: { sessionId: "s1", turnScopeId: "scope-1", dialogProcessId: "dialog-1" },
    currentTurnMessages,
    async commitSummaryCheckpoint(payload) {
      checkpointCalls.push(payload);
      return { committed: true };
    },
  };
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
    modelState: { runtime, eventListener: null, abortSignal: null },
    loopState: {
      tools: [{}],
      traces: [],
      maxTurns: 10,
      modelContext: createModelContext({
        messageBlocks: { system: [], history: [], incremental: [] },
        activeTurnIdentity: { dialogProcessId: "dialog-1", turnScopeId: "scope-1" },
      }),
      turnMessages: [],
      turnTasks: [],
    },
    turn: 1,
  });

  assert.equal(result.output, "done");
  assert.deepEqual(checkpointCalls, []);
});
