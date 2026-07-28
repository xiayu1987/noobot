/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createTurnOrchestrator } from "../../../src/runtime/turn/orchestrator.js";
import { createCurrentTurnMessagesStore } from "../../../src/context/session/current-turn-store.js";

test("task_summary sends one checkpoint command only after the pre-refactor marking completes", async () => {
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
  const currentTurnMessages = createCurrentTurnMessagesStore(structuredClone(messages));
  const checkpointCalls = [];
  const runtime = {
    systemRuntime: { sessionId: "s1", turnScopeId: "scope-1", dialogProcessId: "dialog-1" },
    currentTurnMessages,
    async commitSummaryCheckpoint(payload) {
      checkpointCalls.push(payload);
      assert.equal(oldSystem.summarized, true);
      assert.equal(oldCall.summarized, true);
      assert.equal(oldResult.summarized, true);
      assert.equal(summaryCall.summarized, undefined);
      assert.equal(summaryResult.summarized, undefined);
      return { committed: false };
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
      hasTaskSummaryCall: true,
      hasRequestHelpCall: false,
      hasFinalAnswerCall: false,
    }),
    buildLoopResultFn: ({ output }) => ({ output }),
    removePhaseSummaryPromptMessagesFn: () => {},
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
      messages,
      messageBlocks: { system: [], history: [], incremental: messages },
      turnMessages: currentTurnMessages.toArray(),
      turnTasks: [],
    },
    turn: 1,
  });

  assert.equal(result.output, "done");
  assert.equal(checkpointCalls.length, 1);
  assert.equal(checkpointCalls[0].summaryCompletion.source, "task_summary");
  assert.equal(
    checkpointCalls[0].summaryCompletion.summarizedMessages.every(
      (message) => message.summarized === true || message.lc_kwargs?.summarized === true,
    ),
    true,
  );
});
