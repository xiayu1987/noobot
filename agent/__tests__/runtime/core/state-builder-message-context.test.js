/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveContextMessageKey } from "@noobot/context-protocol/message/codec";

import { createStateBuilder } from "../../../src/runtime/state-builder.js";
import { createMessageEventStreamState } from "../../../src/events/message-event-stream.js";

function createRuntime({ eventListener }) {
  return createTestRuntimeContext({
    eventListener,
    globalConfig: {},
    userConfig: {},
    runConfig: { hookManager: null, turnScopeId: "turn-1" },
    systemRuntime: {
      userId: "admin",
      sessionId: "s1",
      parentSessionId: "parent-s1",
      dialogProcessId: "dlg-1",
      phaseSummaryLoopCount: 0,
      toolConsecutiveFailureCount: 0,
    },
  });
}

test("state-builder canonicalizes model messages and block views through one store", () => {
  const identityEvents = [];

  const system = {
    role: "system",
    content: "system context",
    additional_kwargs: { messageUid: "sm_system_context" },
  };
  const history = {
    role: "assistant",
    content: "history answer",
    additional_kwargs: {
      messageUid: "sm_history_answer",
      dialogProcessId: "dlg-history",
      turnScopeId: "turn-history",
    },
  };
  const currentUserForMessages = {
    role: "user",
    content: "current task",
    additional_kwargs: {
      messageUid: "sm_current_task",
      dialogProcessId: "dlg-1",
      turnScopeId: "turn-1",
    },
  };
  const currentUserForBlocks = {
    role: "user",
    content: "current task",
    additional_kwargs: {
      messageUid: "sm_current_task",
      dialogProcessId: "dlg-1",
      turnScopeId: "turn-1",
    },
  };
  const buildAgentState = createStateBuilder({
    buildContextMessageBlocksFn: () => ({
      system: [system],
      history: [history],
      incremental: [currentUserForBlocks],
      messages: [system, history, currentUserForMessages],
    }),
    normalizeSystemRuntimeCountersFn: () => {},
    resolveEffectiveModelSpecFn: () => ({ model: "test-model", alias: "test" }),
    resolvePhaseSummaryLoopTurnsFn: () => 0,
  });

  const runtime = createRuntime({
    eventListener: { onEvent: (event) => identityEvents.push(event) },
  });
  const agentContext = createTestAgentExecutionScope(runtime, {
    identity: {
      userId: "admin",
      sessionId: "s1",
      parentSessionId: "parent-s1",
      dialogProcessId: "dlg-1",
      turnScopeId: "turn-1",
      rootSessionId: "parent-s1",
      runId: "r-1",
      presentationMessageId: "m-1",
    },
  });

  buildAgentState({
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
    runtime.activeMessageContext.messages.map((message) => message.content),
    ["system context", "history answer", "current task"],
  );
  assert.equal(
    runtime.activeMessageContext.messages[2],
    runtime.activeMessageContext.messageBlocks.incremental[0],
  );
  assert.equal(
    resolveContextMessageKey(runtime.activeMessageContext.messages[2]),
    "sm_current_task",
  );
  assert.equal(runtime.activeMessageContext.messageBlocks.incrementalIds, undefined);
  assert.deepEqual(runtime.activeMessageContext.activeTurnIdentity, {
    dialogProcessId: "dlg-1",
    turnScopeId: "turn-1",
  });
  assert.deepEqual(agentContext.bindings.runtime.stoppedModelMessageSnapshotCandidate, {
    userId: "admin",
    sessionId: "s1",
    parentSessionId: "parent-s1",
    dialogProcessId: "dlg-1",
    turnScopeId: "turn-1",
    systemRuntime: {
      userId: "admin",
      sessionId: "s1",
      parentSessionId: "parent-s1",
      dialogProcessId: "dlg-1",
      phaseSummaryLoopCount: 0,
      toolConsecutiveFailureCount: 0,
      messageEventStream: createMessageEventStreamState(),
    },
  });
  assert.equal(
    agentContext.bindings.runtime.stoppedModelMessageSnapshotCandidate.systemRuntime,
    agentContext.bindings.runtime.systemRuntime,
  );
  const contextIdentityEvents = identityEvents.filter((event) =>
    event.event.startsWith("agent.contextIdentity."),
  );
  assert.deepEqual(
    contextIdentityEvents.map((event) => event.event),
    ["agent.contextIdentity.modelContextCreated", "agent.contextIdentity.snapshotCandidateCreated"],
  );
  assert.equal(Object.hasOwn(contextIdentityEvents[0].data, "debugType"), false);
  assert.equal(contextIdentityEvents[0].data.sourceMessageUid, "sm_current_task");
  assert.equal(contextIdentityEvents[0].data.contentProjectionFound, true);
  assert.equal(contextIdentityEvents[0].data.userMetaProjectionFound, false);
  assert.equal(contextIdentityEvents[1].data.messageIds.includes("sm_current_task"), true);
});
