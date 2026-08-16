/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import {
  assert, fs, os, path, createRunner, finalizeAgentTurn,
  AGENT_LIFECYCLE_BRANCH_STATE, AGENT_LIFECYCLE_EVENT, AGENT_LIFECYCLE_STATE,
  loadStoppedModelMessageSnapshot,
} from "./session-execution-runner-agent-done-order.fixtures.js";

test("runSession restores only the checkpoint-persisted agent prefix at finalization", async () => {
  const callOrder = [];
  const runtime = {
    attachmentMetas: [],
    summaryCheckpointPersistedCount: 1,
    summaryCheckpointPersistedTotal: 2,
  };
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      assistantMessageId: "message-tail",
      traces: [],
      turnMessages: [
        { messageId: "message-retained-persisted", role: "tool", content: "retained-persisted" },
        { messageId: "message-tail", role: "assistant", content: "tail" },
      ],
      turnTasks: [],
    }),
    getSessionTurns: async () => [
      { role: "user", content: "user-input", turnScopeId: "turn-a" },
      { role: "assistant", content: "persisted-1", turnScopeId: "turn-a" },
      { role: "tool", content: "retained-persisted", turnScopeId: "turn-a" },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.equal(capturedFinalizePayload.alreadyPersistedTurnMessageCount, 1);
  assert.deepEqual(
    capturedFinalizePayload.persistedTurnMessages.map((message) => message.content),
    ["persisted-1", "retained-persisted"],
  );
});

test("runSession compares the complete durable turn without treating it as a checkpoint prefix", async () => {
  const callOrder = [];
  let capturedFinalizePayload = null;
  const durableMessages = [
    {
      messageUid: "sm_assistant",
      messageId: "message-assistant",
      role: "assistant",
      content: "already persisted",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_tool",
      messageId: "message-tool",
      role: "tool",
      content: "tool result",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
  ];
  const runner = createRunner({
    callOrder,
    runtime: { attachmentMetas: [] },
    agentRunner: async () => ({
      output: "done",
      assistantMessageId: "message-assistant",
      traces: [],
      turnMessages: durableMessages.map((message) => ({ ...message, summarized: true })),
      turnTasks: [],
    }),
    getSessionTurns: async () => durableMessages,
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "turn-a",
  });

  assert.deepEqual(capturedFinalizePayload.persistedTurnMessages, []);
  assert.deepEqual(capturedFinalizePayload.durableTurnMessages, durableMessages);
  assert.deepEqual(
    capturedFinalizePayload.persistedTurnMessageUids.sort(),
    ["sm_assistant", "sm_tool"],
  );
});

test("runSession upserts summarized messages created after a checkpoint", async () => {
  const callOrder = [];
  let capturedFinalizePayload = null;
  const durableMessages = [
    {
      messageUid: "sm_checkpoint-tool",
      messageId: "msg_checkpoint-tool",
      role: "tool",
      content: "checkpoint result",
      summarized: true,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_tail-tool",
      messageId: "msg_tail-tool",
      role: "tool",
      content: "tail result",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
    {
      messageUid: "sm_final-assistant",
      messageId: "message-final",
      role: "assistant",
      content: "done",
      summarized: false,
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
    },
  ];
  const runner = createRunner({
    callOrder,
    runtime: {
      attachmentMetas: [],
      summaryCheckpointPersistedMessageUids: ["sm_checkpoint-tool"],
      summaryCheckpointPersistedCount: 1,
      summaryCheckpointPersistedTotal: 1,
    },
    agentRunner: async () => ({
      output: "done",
      assistantMessageId: "message-final",
      traces: [],
      turnMessages: durableMessages.map((message) => ({ ...message, summarized: true })),
      turnTasks: [],
    }),
    getSessionTurns: async () => durableMessages,
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runSession({
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
    capturedFinalizePayload.durableTurnMessages.map((message) => [message.messageUid, message.summarized]),
    [["sm_checkpoint-tool", true], ["sm_tail-tool", false], ["sm_final-assistant", false]],
  );
});

test("runSession restores checkpoint messages by exact persistent UID when available", async () => {
  const callOrder = [];
  const runtime = {
    attachmentMetas: [],
    summaryCheckpointPersistedCount: 1,
    summaryCheckpointPersistedTotal: 2,
    summaryCheckpointPersistedMessageUids: ["sm_first", "sm_retained"],
  };
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      assistantMessageId: "message-tail",
      traces: [],
      turnMessages: [
        { messageId: "message-retained", messageUid: "sm_retained", role: "tool", content: "retained-persisted" },
        { messageId: "message-tail", messageUid: "sm_tail", role: "assistant", content: "tail" },
      ],
      turnTasks: [],
    }),
    getSessionTurns: async () => [
      { messageUid: "sm_first", role: "assistant", content: "persisted-1", turnScopeId: "turn-a", dialogProcessId: "dialog-1" },
      { messageUid: "sm_unrelated", role: "assistant", content: "inserted", turnScopeId: "turn-a", dialogProcessId: "dialog-1" },
      { messageUid: "sm_retained", role: "tool", content: "retained-persisted", turnScopeId: "turn-a", dialogProcessId: "dialog-1" },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runSession({
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

test("runSession recovers checkpoint UIDs and active prefix from the durable receipt", async () => {
  const callOrder = [];
  const runtime = { attachmentMetas: [] };
  let capturedFinalizePayload = null;
  const runner = createRunner({
    callOrder,
    runtime,
    agentRunner: async () => ({
      output: "tail",
      assistantMessageId: "message-tail",
      traces: [],
      turnMessages: [
        { messageId: "message-retained", messageUid: "sm_retained", role: "tool", content: "retained-persisted" },
        { messageId: "message-tail", messageUid: "sm_tail", role: "assistant", content: "tail" },
      ],
      turnTasks: [],
    }),
    getTurnSummaryCheckpointState: async () => ({
      checkpointRevision: 1,
      receipts: [{ persistedMessageUids: ["sm_first", "sm_retained"] }],
    }),
    getSessionTurns: async () => [
      { messageUid: "sm_first", role: "assistant", content: "persisted-1", turnScopeId: "turn-a", dialogProcessId: "dialog-1" },
      { messageUid: "sm_retained", role: "tool", content: "retained-persisted", turnScopeId: "turn-a", dialogProcessId: "dialog-1" },
    ],
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
  });

  await runner.runSession({ userId: "u1", sessionId: "s1", message: "hello", turnScopeId: "turn-a" });

  assert.equal(capturedFinalizePayload.alreadyPersistedTurnMessageCount, 1);
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
    dispatchRuntime: {
      timelineCheckpointPersistedMessageUids: ["sm_assistant"],
    },
    getSessionTurns: async () => [{
      messageUid: "sm_assistant",
      role: "assistant",
      type: "tool_call",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-1",
      activityTimeline: [{ eventId: "guidance-analysis:1" }],
    }],
    getTurnSummaryCheckpointState: null,
    finalizeRunSession: async (payload = {}) => {
      capturedFinalizePayload = payload;
      return { ok: true };
    },
    userId: "u1",
    parentSessionId: "",
    parentDialogProcessId: "",
    caller: "user",
    agentResult: {
      turnMessages: [{
        messageUid: "sm_assistant",
        role: "assistant",
        type: "tool_call",
        activityTimeline: [],
      }],
    },
    executionStartIndex: 0,
    userConfig: {},
    resolvedParentAsyncResultContainer: null,
    lifecycle: null,
    persistenceContext: null,
  });

  assert.equal(capturedFinalizePayload.persistedTurnMessages.length, 1);
  assert.equal(capturedFinalizePayload.persistedTurnMessages[0].activityTimeline[0].eventId, "guidance-analysis:1");
  assert.equal(capturedFinalizePayload.alreadyPersistedTurnMessageCount, 1);
});

function collectLifecycleStates(events) {
  return events
    .filter((item) => item.event === AGENT_LIFECYCLE_EVENT)
    .map((item) => item.data.state);
}

function findStoppedLifecycleEvent(events) {
  return events.find(
    (item) => item.event === AGENT_LIFECYCLE_EVENT && item.data?.state === AGENT_LIFECYCLE_BRANCH_STATE.USER_STOPPED,
  );
}

