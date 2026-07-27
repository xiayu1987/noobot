/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../../src/system-core/context/session/current-turn-store.js";
import { commitSummaryCheckpoint } from "../../../src/system-core/bot-manage/session/summary-checkpoint-committer.js";

test("summary checkpoints persist only each new turn increment and release summarized memory", async () => {
  const persisted = [];
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { role: "assistant", content: "M1", summarized: true },
      { role: "tool", content: "M2", summarized: true, attachments: [{ id: "a1" }] },
      { role: "assistant", content: "M3" },
    ]),
  };
  const session = {
    async markSessionMessagesSummarized() { return 2; },
  };
  const turnPersister = {
    async appendAgentMessages({ messages }) { persisted.push(messages); },
  };

  const first = await commitSummaryCheckpoint({
    session,
    turnPersister,
    runtime,
    userId: "u1",
    sessionId: "s1",
  });
  assert.equal(first.committed, true);
  assert.deepEqual(persisted[0].map((message) => message.content), ["M1", "M2", "M3"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.content), ["M3"]);
  assert.equal(runtime.summaryCheckpointPersistedCount, 1);
  assert.deepEqual(runtime.summaryCheckpointPromotionSources, [
    { role: "tool", type: "", attachments: [{ id: "a1" }] },
  ]);

  runtime.currentTurnMessages.push({ role: "assistant", content: "M4", summarized: true });
  runtime.currentTurnMessages.push({ role: "assistant", content: "M5" });
  const second = await commitSummaryCheckpoint({
    session,
    turnPersister,
    runtime,
    userId: "u1",
    sessionId: "s1",
  });
  assert.equal(second.committed, true);
  assert.deepEqual(persisted[1].map((message) => message.content), ["M4", "M5"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.content), ["M3", "M5"]);
  assert.equal(runtime.summaryCheckpointPersistedCount, 2);
});

test("summary checkpoint removes only marked turn messages and preserves retained objects in order", async () => {
  const retained = [
    { role: "user", content: "same", metadata: { sequence: 1 } },
    { role: "user", content: "same", metadata: { sequence: 2 } },
  ];
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      retained[0],
      { role: "assistant", content: "drop", summarized: true },
      retained[1],
    ]),
  };

  await commitSummaryCheckpoint({
    session: { async markSessionMessagesSummarized() { return 1; } },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(runtime.currentTurnMessages.toArray(), retained);
});

test("summary checkpoint keeps memory but advances persisted prefix when archive mutation fails", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { role: "assistant", content: "M1", summarized: true },
      { role: "assistant", content: "M2" },
    ]),
  };
  let appendCount = 0;
  const turnPersister = {
    async appendAgentMessages() { appendCount += 1; },
  };

  await assert.rejects(
    commitSummaryCheckpoint({
      session: { async markSessionMessagesSummarized() { throw new Error("archive failed"); } },
      turnPersister,
      runtime,
      userId: "u1",
      sessionId: "s1",
    }),
    /archive failed/,
  );
  assert.equal(appendCount, 1);
  assert.equal(runtime.summaryCheckpointPersistedCount, 2);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.content), ["M1", "M2"]);
});

test("summary completion syncs only already-marked ids before committing and pruning incremental", async () => {
  const id = (value) => ({ additional_kwargs: { noobotMessageId: value } });
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { role: "user", content: "M1", ...id("m1") },
      { role: "assistant", content: "M2", ...id("m2") },
      { role: "assistant", content: "M3", ...id("m3") },
    ]),
    activeMessageContext: {
      messages: [
        { role: "user", content: "M1", ...id("m1") },
        { role: "assistant", content: "M2", summarized: true, ...id("m2") },
        { role: "assistant", content: "M3", ...id("m3") },
      ],
      messageBlocks: {
        system: [{ role: "system", content: "policy", summarized: true }],
        history: [{ role: "assistant", content: "history", summarized: true }],
        incremental: [
          { role: "user", content: "M1", ...id("m1") },
          { role: "assistant", content: "M2", summarized: true, ...id("m2") },
          { role: "assistant", content: "M3", ...id("m3") },
        ],
      },
    },
  };
  let capturedShouldMark = null;
  const session = {
    async markSessionMessagesSummarized({ shouldMark }) {
      capturedShouldMark = shouldMark;
      return 1;
    },
  };
  const persisted = [];

  const result = await commitSummaryCheckpoint({
    session,
    turnPersister: {
      async appendAgentMessages({ messages }) { persisted.push(...messages); },
    },
    runtime,
    userId: "u1",
    sessionId: "s1",
    summaryCompletion: { summarizedMessageIds: ["m2"] },
  });

  assert.equal(result.committed, true);
  assert.deepEqual(persisted.map((message) => message.content), ["M1", "M2", "M3"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.content), ["M1", "M3"]);
  assert.equal(capturedShouldMark({ ...id("m1") }), false);
  assert.equal(capturedShouldMark({ ...id("m2") }), true);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.system.map((message) => message.content), ["policy"]);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.history.map((message) => message.content), ["history"]);
  assert.deepEqual(runtime.activeMessageContext.messageBlocks.incremental.map((message) => message.content), ["M1", "M3"]);
});

test("summary completion does not over-mark duplicate messages after an id match", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { role: "assistant", content: "same", additional_kwargs: { noobotMessageId: "marked" } },
      { role: "assistant", content: "same", additional_kwargs: { noobotMessageId: "keep" } },
    ]),
  };
  let shouldMark = null;

  await commitSummaryCheckpoint({
    session: {
      async markSessionMessagesSummarized(payload) {
        shouldMark = payload.shouldMark;
        return 1;
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    summaryCompletion: {
      summarizedMessageIds: ["marked"],
      summarizedMessages: [
        { role: "assistant", content: "same", additional_kwargs: { noobotMessageId: "marked" } },
      ],
    },
  });

  assert.deepEqual(runtime.currentTurnMessages.toArray().map((item) => item.additional_kwargs.noobotMessageId), ["keep"]);
  assert.equal(shouldMark({ role: "assistant", content: "same" }), true);
  assert.equal(shouldMark({ role: "assistant", content: "same" }), false);
});

test("summary checkpoint uses exact persistent UIDs when the scoped checkpoint API is available", async () => {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "sm_1", role: "assistant", content: "M1", summarized: true },
      { messageUid: "sm_2", role: "assistant", content: "M2" },
    ]),
  };
  let checkpointPayload = null;
  let legacyMarkCalls = 0;
  const result = await commitSummaryCheckpoint({
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        checkpointPayload = payload;
        return { committed: true, markedCount: 1, checkpointRevision: 4 };
      },
      async markSessionMessagesSummarized() {
        legacyMarkCalls += 1;
        return 1;
      },
    },
    turnPersister: { async appendAgentMessages() {} },
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "t",
  });

  assert.equal(result.committed, true);
  assert.equal(legacyMarkCalls, 0);
  assert.deepEqual(checkpointPayload.persistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(checkpointPayload.summarizedMessageUids, ["sm_1"]);
  assert.equal(checkpointPayload.expectedCheckpointRevision, undefined);
  assert.equal(runtime.summaryCheckpointRevision, 4);
  assert.deepEqual(runtime.summaryCheckpointPersistedMessageUids, ["sm_1", "sm_2"]);
  assert.deepEqual(runtime.currentTurnMessages.toArray().map((message) => message.messageUid), ["sm_2"]);
});
