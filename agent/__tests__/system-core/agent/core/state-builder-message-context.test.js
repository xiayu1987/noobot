/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createStateBuilder } from "../../../../src/system-core/agent/core/state-builder.js";

function createRuntime() {
  return {
    userId: "admin",
    globalConfig: {},
    userConfig: {},
    runConfig: { turnScopeId: "turn-1" },
    systemRuntime: {
      sessionId: "s1",
      parentSessionId: "parent-s1",
      dialogProcessId: "dlg-1",
      toolLoopExecutionCount: 0,
      phaseSummaryLoopCount: 0,
      toolConsecutiveFailureCount: 0,
    },
  };
}

test("state-builder canonicalizes model messages and block views through one store", () => {
  const system = { role: "system", content: "system context" };
  const history = { role: "assistant", content: "history answer" };
  const currentUserForMessages = { role: "user", content: "current task" };
  const currentUserForBlocks = { role: "user", content: "current task" };
  const buildAgentState = createStateBuilder({
    createChatModelFn: () => ({ invoke: async () => ({ content: "ok" }) }),
    mergeConfigFn: () => ({}),
    emitEventFn: () => {},
    buildContextMessageBlocksFn: () => ({
      system: [system],
      history: [history],
      incremental: [currentUserForBlocks],
      messages: [system, history, currentUserForMessages],
    }),
    normalizeSystemRuntimeCountersFn: () => {},
    resolveEffectiveModelSpecFn: () => ({ model: "test-model", alias: "test" }),
    resolveMaxToolLoopTurnsFn: () => 3,
    resolvePhaseSummaryLoopTurnsFn: () => 0,
    resolvePhaseSummaryMessageCharsThresholdFn: () => 0,
    resolveHelpPromptLoopTurnsFn: () => 0,
    resolveToolFailureHelpCountFn: () => 0,
  });

  const runtime = createRuntime();
  const agentContext = {
      payload: {
        messages: { history: [] },
        tools: { registry: [] },
      },
      execution: {
        controllers: {
          runtime,
        },
      },
    };

  const { loopState } = buildAgentState({
    agentContext,
    userMessage: "current task",
  });

  assert.deepEqual(
    loopState.messages.map((message) => message.content),
    ["system context", "history answer", "current task"],
  );
  assert.equal(loopState.messages[2], loopState.messageBlocks.incremental[0]);
  assert.ok(loopState.messages[2].additional_kwargs?.noobotMessageId);
  assert.equal(loopState.messageBlocks.incrementalIds, undefined);
  assert.deepEqual(agentContext.execution.controllers.runtime.stoppedModelMessageSnapshotCandidate, {
    userId: "admin",
    sessionId: "s1",
    parentSessionId: "parent-s1",
    dialogProcessId: "dlg-1",
    turnScopeId: "turn-1",
    messages: loopState.messages,
    messageBlocks: loopState.messageBlocks,
  });
});
