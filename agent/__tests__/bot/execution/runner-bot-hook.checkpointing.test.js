/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createRunner,
  createTestBotHookManager,
  createCanonicalHandledResult,
  HOOK_POINT,
  createAgentCapabilityModelInvoker,
  createBotDispatchHandled,
  createTestAgentExecutionScope,
  createCurrentTurnMessagesStore,
} from "./runner-bot-hook.fixtures.js";

test("SessionExecutionRunner checkpoints current turn messages with scoped persistence identity", async () => {
  const checkpointPayloads = [];
  const events = [];
  const persistenceContext = { kind: "noobot.session_persistence_scope", scope: "running-turn" };
  const runtime = {
    attachmentMetas: [],
    currentTurnMessages: {
      items: [
        {
          messageUid: "sm_checkpoint",
          role: "assistant",
          type: "message",
          content: "analysis",
          presentationMessageId: "msg_chat_checkpoint",
          chatPresentation: true,
          activityTimeline: [{ eventId: "activity-checkpoint-1" }],
          toolTimeline: [{ toolCallId: "tool-checkpoint-1" }],
        },
      ],
      toArray() {
        return this.items.slice();
      },
    },
  };
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async (payload = {}) => {
      checkpointPayloads.push(payload);
      return payload.messages;
    },
    getSessionTurns: async () => checkpointPayloads.at(-1)?.messages || [],
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      runtimeAgentContext,
    }),
    agentRunner: async ({ agentContext }) => {
      await agentContext.bindings.runtime.persistCurrentTurnMessages();
      return { output: "ok", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "root-1",
    parentDialogProcessId: "parent-dp-1",
    message: "task",
    turnScopeId: "turn-checkpoint",
    persistenceContext,
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.equal(checkpointPayloads.length, 1);
  assert.equal(checkpointPayloads[0].userId, "u1");
  assert.equal(checkpointPayloads[0].sessionId, "s1");
  assert.equal(checkpointPayloads[0].parentSessionId, "root-1");
  assert.equal(checkpointPayloads[0].parentDialogProcessId, "parent-dp-1");
  assert.equal(checkpointPayloads[0].turnScopeId, "turn-checkpoint");
  assert.equal(checkpointPayloads[0].persistenceContext, persistenceContext);
  assert.equal(checkpointPayloads[0].messages[0].presentationMessageId, "msg_chat_checkpoint");
  assert.deepEqual(
    events.find((event) => event?.event === "timeline_checkpoint_persisted")?.data?.messages?.[0],
    {
      messageUid: "sm_checkpoint",
      messageId: "",
      presentationMessageId: "msg_chat_checkpoint",
      role: "assistant",
      type: "message",
      chatPresentation: true,
      contentLength: 8,
      activityTimelineCount: 1,
      toolTimelineCount: 1,
      toolCallIds: ["tool-checkpoint-1"],
      activityTimeline: [
        {
          eventId: "activity-checkpoint-1",
          activityKind: "",
          sequence: 0,
          sequenceDomain: "",
          sequenceScopeId: "",
          authority: "",
        },
      ],
    },
  );
});

test("SessionExecutionRunner checkpoints only new or changed current-turn messages", async () => {
  const checkpointPayloads = [];
  const events = [];
  const runtime = {
    attachmentMetas: [],
    currentTurnMessages: createCurrentTurnMessagesStore([
      {
        messageUid: "sm_assistant",
        role: "assistant",
        type: "message",
        content: "analysis",
        activityTimeline: [{ eventId: "activity-1" }],
      },
      {
        messageUid: "sm_tool_1",
        role: "tool",
        type: "tool_result",
        content: "result-1",
        tool_call_id: "call-1",
      },
    ]),
  };
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async (payload = {}) => checkpointPayloads.push(payload),
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      runtimeAgentContext,
    }),
    agentRunner: async ({ agentContext }) => {
      const currentRuntime = agentContext.bindings.runtime;
      await currentRuntime.persistCurrentTurnMessages();
      await currentRuntime.persistCurrentTurnMessages();
      currentRuntime.currentTurnMessages.push({
        messageUid: "sm_tool_2",
        role: "tool",
        type: "tool_result",
        content: "result-2",
        tool_call_id: "call-2",
      });
      await currentRuntime.persistCurrentTurnMessages();
      currentRuntime.currentTurnMessages.updateWhere(
        { activityTimeline: [{ eventId: "activity-1" }, { eventId: "activity-2" }] },
        (message) => message.messageUid === "sm_assistant",
      );
      await currentRuntime.persistCurrentTurnMessages();
      return { output: "ok", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "task",
    turnScopeId: "turn-incremental-checkpoint",
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.deepEqual(
    checkpointPayloads.map((payload) => payload.messages.map((message) => message.messageUid)),
    [["sm_assistant", "sm_tool_1"], ["sm_tool_2"], ["sm_assistant"]],
  );
  assert.deepEqual(runtime.timelineCheckpointPersistedMessageUids, [
    "sm_assistant",
    "sm_tool_1",
    "sm_tool_2",
  ]);
  const checkpointEvents = events.filter(
    (event) => event?.event === "timeline_checkpoint_persisted",
  );
  assert.equal(checkpointEvents.length, 3);
  assert.equal(checkpointEvents.at(-1)?.data?.messageCount, 3);
  assert.equal(checkpointEvents.at(-1)?.data?.persistedMessageCount, 1);
  assert.deepEqual(
    checkpointEvents.at(-1)?.data?.messages?.map((message) => message.messageUid),
    ["sm_assistant"],
  );
});

test("SessionExecutionRunner coalesces persistence requests inside one tool-result batch", async () => {
  const checkpointPayloads = [];
  const runtime = {
    attachmentMetas: [],
    currentTurnMessages: createCurrentTurnMessagesStore([]),
  };
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async (payload = {}) => checkpointPayloads.push(payload),
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      runtimeAgentContext,
    }),
    agentRunner: async ({ agentContext }) => {
      const currentRuntime = agentContext.bindings.runtime;
      await currentRuntime.withCurrentTurnPersistenceBatch(async () => {
        currentRuntime.currentTurnMessages.push({
          messageUid: "sm_tool_1",
          role: "tool",
          type: "tool_result",
          content: "one",
        });
        await currentRuntime.persistCurrentTurnMessages();
        currentRuntime.currentTurnMessages.push({
          messageUid: "sm_tool_2",
          role: "tool",
          type: "tool_result",
          content: "two",
        });
        await currentRuntime.persistCurrentTurnMessages();
      });
      return { output: "ok", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "task",
    turnScopeId: "turn-batched-checkpoint",
  });

  assert.equal(checkpointPayloads.length, 1);
  assert.deepEqual(
    checkpointPayloads[0].messages.map((message) => message.messageUid),
    ["sm_tool_1", "sm_tool_2"],
  );
});

test("SessionExecutionRunner retries an incremental checkpoint after persistence failure", async () => {
  const attempts = [];
  const runtime = {
    attachmentMetas: [],
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_retry", role: "tool", type: "tool_result", content: "retry" },
    ]),
  };
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async ({ messages = [] } = {}) => {
      attempts.push(messages.map((message) => message.messageUid));
      if (attempts.length === 1) throw new Error("checkpoint unavailable");
    },
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      runtimeAgentContext,
    }),
    agentRunner: async ({ agentContext }) => {
      const currentRuntime = agentContext.bindings.runtime;
      await assert.rejects(currentRuntime.persistCurrentTurnMessages(), /checkpoint unavailable/);
      await currentRuntime.persistCurrentTurnMessages();
      return { output: "ok", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "task",
    turnScopeId: "turn-checkpoint-retry",
  });

  assert.deepEqual(attempts, [["sm_retry"], ["sm_retry"]]);
  assert.deepEqual(runtime.timelineCheckpointPersistedMessageUids, ["sm_retry"]);
});

test("SessionExecutionRunner validates scoped persistence identity before execution", async () => {
  const calls = [];
  const persistenceContext = { kind: "noobot.session_persistence_scope" };
  const runner = createRunner({
    assertPersistenceContextIdentity: (context, identity) => calls.push({ context, identity }),
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "child-1",
    parentSessionId: "root-1",
    message: "task",
    runConfig: { executionId: "agent:child-1" },
    persistenceContext,
  });

  assert.deepEqual(calls, [
    {
      context: persistenceContext,
      identity: {
        userId: "u1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        scopeId: "agent:child-1",
      },
    },
  ]);
});

