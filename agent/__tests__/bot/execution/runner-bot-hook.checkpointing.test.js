/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import assert from "node:assert/strict";
import { createModelMessageId } from "@noobot/session-protocol/message-identity";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  createRunner,
  createTestAgentExecutionScope,
  createCurrentTurnMessagesStore,
} from "./runner-bot-hook.fixtures.js";

test("SessionExecutionRunner checkpoints current turn messages with scoped persistence identity", async () => {
  const checkpointPayloads = [];
  const events = [];
  const persistenceScope = {
    scopeId: "agent:turn-checkpoint",
    parentSessionId: "root-1",
    relativeDir: "runtime/agent/session/s1",
    allowedRoot: "runtime/agent/session",
  };
  const runtime = Object.assign(createTestRuntimeContext(), {
    currentTurnMessages: createCurrentTurnMessagesStore([
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
    ]),
  });
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async (payload = {}) => {
      checkpointPayloads.push(payload);
      return payload.messages;
    },
    getSessionTurns: async () => checkpointPayloads.at(-1)?.messages || [],
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      userMessageAttachments: [],
    }),
    agentRunner: async ({ agentContext }) => {
      await agentContext.bindings.runtime.persistCurrentTurnMessages();
      return {
        output: "ok",
        modelMessageId: createModelMessageId(),
        traces: [],
        turnMessages: [],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "root-1",
    parentDialogProcessId: "parent-dp-1",
    message: "task",
    turnScopeId: "turn-checkpoint",
    persistenceScope,
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.equal(checkpointPayloads.length, 1);
  assert.equal(checkpointPayloads[0].userId, "u1");
  assert.equal(checkpointPayloads[0].sessionId, "s1");
  assert.equal(checkpointPayloads[0].parentDialogProcessId, "parent-dp-1");
  assert.equal(checkpointPayloads[0].turnScopeId, "turn-checkpoint");
  assert.deepEqual(checkpointPayloads[0].persistenceScope, persistenceScope);
  assert.equal(checkpointPayloads[0].messages[0].presentationMessageId, "msg_chat_checkpoint");
  assert.deepEqual(
    events.find((event) => event?.event === "timeline_checkpoint_persisted")?.data?.messages?.[0],
    {
      messageUid: "sm_checkpoint",
      modelMessageId: "",
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
          eventType: "",
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
  const runtime = Object.assign(createTestRuntimeContext(), {
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
  });
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async (payload = {}) => {
      checkpointPayloads.push(payload);
      return payload.messages;
    },
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      userMessageAttachments: [],
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
      return {
        output: "ok",
        modelMessageId: createModelMessageId(),
        traces: [],
        turnMessages: [],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
  });

  await runner.runAcceptedSession({
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
  const runtime = Object.assign(createTestRuntimeContext(), {
    currentTurnMessages: createCurrentTurnMessagesStore([]),
  });
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async (payload = {}) => {
      checkpointPayloads.push(payload);
      return payload.messages;
    },
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      userMessageAttachments: [],
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
      return {
        output: "ok",
        modelMessageId: createModelMessageId(),
        traces: [],
        turnMessages: [],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
  });

  await runner.runAcceptedSession({
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
  const runtime = Object.assign(createTestRuntimeContext(), {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_retry", role: "tool", type: "tool_result", content: "retry" },
    ]),
  });
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async ({ messages = [] } = {}) => {
      attempts.push(messages.map((message) => message.messageUid));
      if (attempts.length === 1) throw new Error("checkpoint unavailable");
      return messages;
    },
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      userMessageAttachments: [],
    }),
    agentRunner: async ({ agentContext }) => {
      const currentRuntime = agentContext.bindings.runtime;
      await assert.rejects(currentRuntime.persistCurrentTurnMessages(), /checkpoint unavailable/);
      await currentRuntime.persistCurrentTurnMessages();
      return {
        output: "ok",
        modelMessageId: createModelMessageId(),
        traces: [],
        turnMessages: [],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "task",
    turnScopeId: "turn-checkpoint-retry",
  });

  assert.deepEqual(attempts, [["sm_retry"], ["sm_retry"]]);
  assert.deepEqual(runtime.timelineCheckpointPersistedMessageUids, ["sm_retry"]);
});

test("SessionExecutionRunner rejects invalid persistence scopes before execution", async () => {
  let initialized = false;
  const runner = createRunner({
    initializeRunSessionRuntime: async () => {
      initialized = true;
      throw new Error("must not initialize");
    },
  });

  await assert.rejects(
    runner.runAcceptedSession({
      turnScopeId: "turn-invalid-scope",
      userId: "u1",
      sessionId: "child-1",
      parentSessionId: "root-1",
      message: "task",
      persistenceScope: { scopeId: "agent:child-1", parentSessionId: "root-1" },
    }),
    /invalid Session persistence scope: incomplete_persistence_scope/,
  );
  assert.equal(initialized, false);
});

test("SessionExecutionRunner hands the validated persistence scope to session initialization", async () => {
  const persistenceScope = {
    scopeId: "agent:child-1",
    parentSessionId: "root-1",
    relativeDir: "runtime/agent/session/child-1",
    allowedRoot: "runtime/agent/session",
  };
  const initializedScopes = [];
  const runner = createRunner({
    initializeRunSessionRuntime: async (payload = {}) => {
      initializedScopes.push(payload.persistenceScope);
      return {
        usedSessionId: "child-1",
        parentSessionId: payload.parentSessionId,
        dialogProcessId: "dp1",
        sessionLoadState: "created",
        userConfig: {},
        currentSessionModelAlias: "",
        runtimeEventListener: payload.eventListener,
      };
    },
  });

  await runner.runAcceptedSession(
    {
      turnScopeId: "turn-default",
      userId: "u1",
      sessionId: "child-1",
      parentSessionId: "root-1",
      message: "task",
      runConfig: { executionId: "agent:child-1" },
      persistenceScope,
    },
    { dialogProcessId: "dp1", committedEventPublished: false },
  );

  assert.deepEqual(initializedScopes, [persistenceScope]);
});

test("SessionExecutionRunner rejects a checkpoint whose messages are missing from the durable result", async () => {
  const runtime = Object.assign(createTestRuntimeContext(), {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_durable", role: "tool", type: "tool_result", content: "a" },
      { messageUid: "sm_lost", role: "tool", type: "tool_result", content: "b" },
    ]),
  });
  const runtimeAgentContext = createTestAgentExecutionScope(runtime);
  const runner = createRunner({
    appendAgentMessages: async ({ messages = [] } = {}) =>
      messages.filter((message) => message.messageUid !== "sm_lost"),
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      userMessageAttachments: [],
    }),
    agentRunner: async ({ agentContext }) => {
      await assert.rejects(agentContext.bindings.runtime.persistCurrentTurnMessages(), {
        code: SESSION_ERROR_CODE.TURN_MESSAGE_NOT_PERSISTED,
        missingMessageUids: ["sm_lost"],
      });
      return {
        output: "ok",
        modelMessageId: createModelMessageId(),
        traces: [],
        turnMessages: [],
        modelLoopRound: 0,
        modelMessages: [],
      };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "task",
    turnScopeId: "turn-checkpoint-lost",
  });
  assert.deepEqual(runtime.timelineCheckpointPersistedMessageUids, []);
});
