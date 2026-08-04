/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../src/context/session/current-turn-store.js";
import { commitSummaryCheckpoint } from "../../src/bot/session/summary-checkpoint-committer.js";

test("summary checkpoint persists unmodified messages before atomically marking exact UIDs", async () => {
  const messages = [
    { messageUid: "sm_1", role: "assistant", content: "M1" },
    { messageUid: "sm_2", role: "tool", content: "M2", attachments: [{ id: "a1" }] },
    { messageUid: "sm_3", role: "assistant", content: "M3" },
  ];
  const runtime = { currentTurnMessages: createCurrentTurnMessagesStore(messages) };
  const persisted = [];
  let checkpointPayload = null;
  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        assert.equal(persisted.every((message) => message.summarized !== true), true);
        return { committed: true, markedCount: 2, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages({ messages: batch }) { persisted.push(...batch); } },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: { source: "plugin.summary", summarizedMessageIds: ["sm_1", "sm_2"] },
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.messageUid), ["sm_3"]);
  assert.deepEqual(runtime.summaryCheckpointPromotionSources, [
    { role: "tool", type: "", attachments: [{ id: "a1" }] },
  ]);
});

test("failed summary transaction leaves canonical memory and persisted messages unmarked", async () => {
  const messages = [
    { messageUid: "sm_1", role: "assistant", content: "M1" },
    { messageUid: "sm_2", role: "assistant", content: "M2" },
  ];
  const runtime = { currentTurnMessages: createCurrentTurnMessagesStore(messages) };
  const persisted = [];
  await assert.rejects(commitSummaryCheckpoint({
    session: { async commitTurnSummaryCheckpoint() { throw new Error("checkpoint failed"); } },
    turnPersister: { async appendAgentMessages({ messages: batch }) { persisted.push(...batch); } },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: { summarizedMessageIds: ["sm_1"] },
  }), /checkpoint failed/);

  assert.equal(persisted.every((message) => message.summarized !== true), true);
  assert.deepEqual(runtime.currentTurnMessages.toArray(), messages);
});

test("summary completion never falls back to content identity", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "marked", role: "assistant", content: "same" },
      { messageUid: "keep", role: "assistant", content: "same" },
    ]),
  };
  await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        assert.deepEqual(payload.summarizedMessageUids, ["marked"]);
        return { committed: true, markedCount: 1, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    summaryCompletion: { summarizedMessageIds: ["marked"] },
  });

  assert.deepEqual(runtime.currentTurnMessages.toArray().map((item) => item.messageUid), ["keep"]);
});

test("summary checkpoint uses exact persistent UIDs when the scoped checkpoint API is available", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_1", role: "assistant", content: "M1", summarized: true },
      { messageUid: "sm_2", role: "assistant", content: "M2" },
    ]),
  };
  let checkpointPayload = null;
  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 1, checkpointRevision: 4 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    summaryCompletion: { summarizedMessageIds: ["sm_1"] },
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.persistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1"]);
  assert.equal(checkpointPayload.expectedCheckpointRevision, undefined);
  assert.equal(runtime.summaryCheckpointRevision, 4);
  assert.deepEqual(runtime.summaryCheckpointPersistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.messageUid), ["sm_2"]);
});

test("summary checkpoint does not replay messages already persisted by the timeline checkpoint", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_1", role: "assistant", content: "M1", summarized: true },
      { messageUid: "sm_2", role: "tool", content: "M2" },
    ]),
    timelineCheckpointPersistedMessageUids: ["sm_1", "sm_2"],
  };
  let appendCount = 0;
  let checkpointPayload = null;

  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 1, checkpointRevision: 1 };
      },
    },
    turnPersister: {
      async appendAgentMessages() { appendCount += 1; },
    },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
    summaryCompletion: { summarizedMessageIds: ["sm_1"] },
  });

  assert.equal(result.committed, true);
  assert.equal(appendCount, 0);
  assert.deepEqual(checkpointPayload.persistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.messageUid), ["sm_2"]);
});

test("summary checkpoint closes assistant tool-call and tool-result identity as one exact scope", async () => {
  const ids = ["sm_call", "sm_result_1", "sm_result_2"];
  const turnMessages = [
    {
      messageUid: ids[0],
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", function: { name: "read_file" } },
        { id: "call_2", function: { name: "read_file" } },
      ],
    },
    { messageUid: ids[1], role: "tool", content: "one", tool_call_id: "call_1" },
    { messageUid: ids[2], role: "tool", content: "two", tool_call_id: "call_2" },
  ];
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore(turnMessages),
    activeMessageContext: {
      messages: turnMessages.map((message) => ({
        ...message,
        summarized: true,
        additional_kwargs: { noobotMessageId: message.messageUid },
      })),
      messageBlocks: {
        system: [],
        history: [],
        incremental: turnMessages.map((message) => ({
          ...message,
          summarized: true,
          additional_kwargs: { noobotMessageId: message.messageUid },
        })),
      },
    },
  };
  const persisted = [];
  let checkpointPayload = null;

  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: ids.length, checkpointRevision: 1 };
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages }) {
        persisted.push(...messages);
      },
    },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
    summaryCompletion: {
      source: "plugin.summary",
      summarizedMessageIds: ids,
    },
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ids);
  assert.deepEqual(persisted.map((message) => message.messageUid), ids);
  assert.equal(persisted.every((message) => message.summarized !== true), true);
  assert.deepEqual(runtime.currentTurnMessages.toArray(), []);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.incremental, []);
});

test("summary checkpoint passes restored historical UIDs to the active Turn transaction", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_current_call", role: "assistant", content: "", tool_calls: [{ id: "call_current" }] },
      { messageUid: "sm_current_result", role: "tool", content: "ok", tool_call_id: "call_current" },
    ]),
    timelineCheckpointPersistedMessageUids: ["sm_current_call", "sm_current_result"],
  };
  let checkpointPayload = null;

  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 3, checkpointRevision: 1 };
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-current",
    turnScopeId: "turn-current",
    summaryCompletion: {
      source: "plugin.summary",
      summarizedMessageIds: ["sm_history_call", "sm_history_result", "sm_current_call"],
    },
  });

  assert.equal(result.committed, true);
  assert.deepEqual(checkpointPayload.persistedMessageUids, ["sm_current_call", "sm_current_result"]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, [
    "sm_history_call",
    "sm_history_result",
    "sm_current_call",
  ]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.messageUid), [
    "sm_current_result",
  ]);
});
