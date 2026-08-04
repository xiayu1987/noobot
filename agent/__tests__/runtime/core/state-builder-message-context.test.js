/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createStateBuilder } from "../../../src/runtime/state-builder.js";

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
  const identityEvents = [];
  const system = { role: "system", content: "system context" };
  const history = { role: "assistant", content: "history answer" };
  const currentUserForMessages = {
    role: "user",
    content: "current task",
    additional_kwargs: { noobotMessageId: "sm_current_task" },
  };
  const currentUserForBlocks = {
    role: "user",
    content: "current task",
    additional_kwargs: { noobotMessageId: "sm_current_task" },
  };
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
  runtime.eventListener = {
    onEvent: (event) => identityEvents.push(event),
  };
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
    currentUserMessage: {
      messageUid: "sm_current_task",
      role: "user",
      content: "current task",
      dialogProcessId: "dlg-1",
      turnScopeId: "turn-1",
    },
  });

  assert.deepEqual(
    loopState.modelContext.messages.map((message) => message.content),
    ["system context", "history answer", "current task"],
  );
  assert.equal(loopState.modelContext.messages[2], loopState.modelContext.messageBlocks.incremental[0]);
  assert.equal(loopState.modelContext.messages[2].additional_kwargs?.noobotMessageId, "sm_current_task");
  assert.equal(loopState.modelContext.messageBlocks.incrementalIds, undefined);
  assert.deepEqual(loopState.modelContext.activeTurnIdentity, {
    dialogProcessId: "dlg-1",
    turnScopeId: "turn-1",
  });
  assert.deepEqual(agentContext.execution.controllers.runtime.stoppedModelMessageSnapshotCandidate, {
    userId: "admin",
    sessionId: "s1",
    parentSessionId: "parent-s1",
    dialogProcessId: "dlg-1",
    turnScopeId: "turn-1",
    messages: loopState.modelContext.messages,
    messageBlocks: loopState.modelContext.messageBlocks,
  });
  assert.deepEqual(
    identityEvents
      .filter((event) => event.event.startsWith("agent.contextIdentity."))
      .map((event) => event.event),
    [
      "agent.contextIdentity.modelContextCreated",
      "agent.contextIdentity.snapshotCandidateCreated",
    ],
  );
  assert.equal(identityEvents[0].data.debugType, "context-identity");
  assert.equal(identityEvents[0].data.sourceMessageUid, "sm_current_task");
  assert.equal(identityEvents[0].data.contentProjectionId, "sm_current_task");
  assert.equal(identityEvents[0].data.userMetaProjectionId, "");
  assert.equal(identityEvents[1].data.messageIds.includes("sm_current_task"), true);
});
