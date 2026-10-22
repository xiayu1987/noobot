/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  appendTurnSummaryCheckpointReceipt,
  createEmptyTurnSummaryCheckpointState,
} from "@noobot/context-protocol/policy/summary";
import test from "node:test";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import {
  assert,
  createRunner,
  finalizeAgentTurn,
} from "./session-execution-runner-agent-done-order.fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("runSession compares the complete durable turn without treating it as a checkpoint prefix", async () => {
  const callOrder = [];
  let capturedFinalizePayload = null;
  const durableMessages = [
    {
      messageUid: "sm_assistant",
      modelMessageId: "message-assistant",
      role: "assistant",
      content: "already persisted",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_tool",

      role: "tool",
      content: "tool result",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
  ];
  const runner = createRunner({
    callOrder,
    runtime: createTestRuntimeContext(),
    agentRunner: async () => ({
      output: "done",
      modelMessageId: "message-assistant",
      traces: [],
      turnMessages: durableMessages.map((message) => ({ ...message, summarized: true })),
      turnTasks: [],
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getSessionTurns: async () => durableMessages,
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.persistedTurnMessages, []);
  assert.deepEqual(capturedFinalizePayload.durableTurnMessages, durableMessages);
  assert.deepEqual(capturedFinalizePayload.persistedTurnMessageUids.sort(), [
    "sm_assistant",
    "sm_tool",
  ]);
});

test("runSession upserts summarized messages created after a checkpoint", async () => {
  const callOrder = [];
  let capturedFinalizePayload = null;
  const durableMessages = [
    {
      messageUid: "sm_checkpoint-tool",

      role: "tool",
      content: "checkpoint result",
      summarized: true,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_tail-tool",

      role: "tool",
      content: "tail result",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_final-assistant",
      modelMessageId: "message-final",
      role: "assistant",
      content: "done",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
  ];
  const runner = createRunner({
    callOrder,
    runtime: createTestRuntimeContext({
      summaryCheckpointPersistedMessageUids: ["sm_checkpoint-tool"],
    }),
    agentRunner: async () => ({
      output: "done",
      modelMessageId: "message-final",
      traces: [],
      turnMessages: durableMessages.map((message) => ({ ...message, summarized: true })),
      turnTasks: [],
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getSessionTurns: async () => durableMessages,
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(
    capturedFinalizePayload.persistedTurnMessageUids.sort(),
    ["sm_checkpoint-tool", "sm_tail-tool", "sm_final-assistant"].sort(),
  );
  assert.deepEqual(
    capturedFinalizePayload.durableTurnMessages.map((message) => [
      message.messageUid,
      message.summarized,
    ]),
    [
      ["sm_checkpoint-tool", true],
      ["sm_tail-tool", false],
      ["sm_final-assistant", false],
    ],
  );
});

test("runSession restores checkpoint messages by exact persistent UID when available", async () => {
  const callOrder = [];
  const runtime = createTestRuntimeContext({
    summaryCheckpointPersistedMessageUids: ["sm_first", "sm_retained"],
  });
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      modelMessageId: "message-tail",
      traces: [],
      turnMessages: [
        {
          messageUid: "sm_retained",
          role: "tool",
          content: "retained-persisted",
        },
        {
          modelMessageId: "message-tail",
          messageUid: "sm_tail",
          role: "assistant",
          content: "tail",
        },
      ],
      turnTasks: [],
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getSessionTurns: async () => [
      {
        messageUid: "sm_first",
        role: "assistant",
        content: "persisted-1",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
      {
        messageUid: "sm_unrelated",
        role: "assistant",
        content: "inserted",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
      {
        messageUid: "sm_retained",
        role: "tool",
        content: "retained-persisted",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(
    capturedFinalizePayload.persistedTurnMessages.map((message) => message.messageUid),
    ["sm_first", "sm_retained"],
  );
});

test("runSession recovers checkpoint UIDs from the durable receipt", async () => {
  const callOrder = [];
  const runtime = createTestRuntimeContext();
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      modelMessageId: "message-tail",
      traces: [],
      turnMessages: [
        {
          messageUid: "sm_retained",
          role: "tool",
          content: "retained-persisted",
        },
        {
          modelMessageId: "message-tail",
          messageUid: "sm_tail",
          role: "assistant",
          content: "tail",
        },
      ],
      turnTasks: [],
      modelLoopRound: 0,
      modelMessages: [],
    }),
    getTurnSummaryCheckpointState: async ({ dialogProcessId, turnScopeId }) =>
      appendTurnSummaryCheckpointReceipt(
        createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }),
        {
          checkpointId: "summary_checkpoint_a",
          checkpointRevision: 1,
          requestHash: "sha256:a",
          persistedMessageUids: ["sm_first", "sm_retained"],
          summarizedMessageUids: ["sm_first"],
          retainedMessageUids: ["sm_retained"],
          markedCount: 1,
          committedAt: "2026-01-01T00:00:00.000Z",
        },
      ),
    getSessionTurns: async () => [
      {
        messageUid: "sm_first",
        role: "assistant",
        content: "persisted-1",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
      {
        messageUid: "sm_retained",
        role: "tool",
        content: "retained-persisted",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
      },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(
    capturedFinalizePayload.persistedTurnMessages.map((message) => message.messageUid),
    ["sm_first", "sm_retained"],
  );
});

test("finalizer preserves canonical activity from the timeline checkpoint", async () => {
  let capturedFinalizePayload = null;
  await finalizeAgentTurn({
    resolvedRunConfig: {},
    runtimeEventListener: null,
    usedSessionId: "s1",
    dialogProcessId: "dialog-1",
    resolvedTurnScopeId: "turn-a",
    dispatchRuntime: createTestRuntimeContext({
      timelineCheckpointPersistedMessageUids: ["sm_assistant"],
    }),
    getSessionTurns: async () => [
      {
        messageUid: "sm_assistant",
        role: "assistant",
        type: "tool_call",
        turnScopeId: "turn-a",
        dialogProcessId: "dialog-1",
        activityTimeline: [{ eventId: "guidance-analysis:1" }],
      },
    ],
    getTurnSummaryCheckpointState: async ({ dialogProcessId, turnScopeId }) =>
      createEmptyTurnSummaryCheckpointState({ dialogProcessId, turnScopeId }),
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
    userId: "u1",
    parentSessionId: "",
    parentDialogProcessId: "",
    caller: SESSION_CALLER.USER,
    agentResult: {
      turnMessages: [
        {
          messageUid: "sm_assistant",
          role: "assistant",
          type: "tool_call",
          activityTimeline: [],
        },
      ],
    },
    userConfig: {},
    lifecycle: null,
    persistenceContext: null,
  });

  assert.equal(capturedFinalizePayload.persistedTurnMessages.length, 1);
  assert.equal(
    capturedFinalizePayload.persistedTurnMessages[0].activityTimeline[0].eventId,
    "guidance-analysis:1",
  );
});
