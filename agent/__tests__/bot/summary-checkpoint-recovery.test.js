/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { commitSummaryCheckpoint } from "../../src/bot/session/summary-checkpoint-committer.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { summaryCheckpointResult } from "../helpers/summary-checkpoint-result.js";
import { createSummaryCheckpointInstruction } from "@noobot/context-protocol/policy/main-flow-control";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createUserMetaBackwrite } from "@noobot/context-protocol/policy/user-meta-backwrite";

function fixture() {
  const message = {
    messageUid: "work",
    role: "assistant",
    content: "completed",
    attachments: [{ id: "a1" }],
  };
  const source = writeContextMessageMetadata(
    { role: "user", content: "task" },
    { messageUid: "user" },
  );
  const runtime = createTestRuntimeContext({
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [source], incremental: [] },
    }),
  });
  runtime.currentTurnMessages.replaceAll([message]);
  const payloads = [];
  const input = {
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp",
    turnScopeId: "turn",
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        const { submission, ...request } = payload;
        payloads.push({ ...structuredClone(request), submission });
        return summaryCheckpointResult(payload, {
          committed: true,
          markedCount: 1,
          checkpointRevision: 1,
        });
      },
    },
    turnPersister: { prepareAgentMessages: ({ messages }) => messages },
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "agent.phase_summary",
      summarizedMessageUids: ["work"],
    }),
  };
  return { input, runtime, payloads };
}

test("checkpoint retries backwrite after persistence without repeating the commit or marking new work", async () => {
  const { input, runtime, payloads } = fixture();
  runtime.activeMessageContext.userMetaBackwrites = [
    createUserMetaBackwrite({
      userMetaSourceMessageUid: "user",
      attachmentRef: "attachment:test",
      result: { sourceAttachmentRef: "attachment:test", status: "completed" },
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  ];
  let attempts = 0;
  input.session.recordUserMetaParsedResult = async ({ result }) => {
    if (++attempts === 1) throw new Error("backwrite unavailable");
    return { userMetaParsedResults: [result] };
  };
  await assert.rejects(commitSummaryCheckpoint(input), /backwrite unavailable/);
  runtime.currentTurnMessages.push({ messageUid: "new", role: "assistant", content: "new work" });
  await commitSummaryCheckpoint(input);
  assert.equal(payloads.length, 1);
  assert.equal(attempts, 2);
  assert.equal(runtime.activeMessageContext.userMetaBackwrites.length, 0);
  assert.deepEqual(
    runtime.currentTurnMessages.toArray().map(({ messageUid }) => messageUid),
    ["new"],
  );
  assert.equal(runtime.summaryCheckpointPromotionSources.length, 1);
});

test("checkpoint notification retries do not repeat persistence or attachment promotion", async () => {
  const { input, runtime, payloads } = fixture();
  let notifications = 0;
  input.eventListener = {
    async onEvent() {
      if (++notifications === 1) throw new Error("notification unavailable");
    },
  };
  await assert.rejects(commitSummaryCheckpoint(input), /notification unavailable/);
  await commitSummaryCheckpoint(input);
  await commitSummaryCheckpoint(input);
  assert.equal(payloads.length, 1);
  assert.equal(notifications, 2);
  assert.equal(runtime.summaryCheckpointPromotionSources.length, 1);
});

test("checkpoint waiting for persistence leaves changed targets and new messages pending", async () => {
  const { input, runtime, payloads } = fixture();
  const commit = input.session.commitTurnSummaryCheckpoint;
  let release;
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  input.session.commitTurnSummaryCheckpoint = async (payload) => {
    started();
    await waiting;
    return commit(payload);
  };
  const pending = commitSummaryCheckpoint(input);
  await entered;
  runtime.currentTurnMessages.updateByUid("work", { content: "updated after summary" });
  runtime.currentTurnMessages.push({ messageUid: "new", role: "user", content: "new requirement" });
  release();
  await pending;
  assert.equal(payloads[0].messages[0].content, "completed");
  assert.deepEqual(payloads[0].summarizedMessageUids, ["work"]);
  assert.equal(runtime.currentTurnMessages.readByUid("work").content, "updated after summary");
  assert.notEqual(runtime.currentTurnMessages.readByUid("work").summarized, true);
  assert.equal(runtime.summaryCheckpointPromotionSources.length, 0);
  assert.deepEqual(
    runtime.currentTurnMessages.readPendingChanges().entries.map(({ messageUid }) => messageUid),
    ["work", "new"],
  );
});

test("uncertain commit retries keep the original request and leave later work pending", async () => {
  const { input, runtime, payloads } = fixture();
  const commit = input.session.commitTurnSummaryCheckpoint;
  input.session.commitTurnSummaryCheckpoint = async (payload) => {
    const result = await commit(payload);
    if (payloads.length === 1) throw new Error("receipt lost");
    return { ...result, deduplicated: true };
  };
  await assert.rejects(commitSummaryCheckpoint(input), /receipt lost/);
  runtime.currentTurnMessages.push({
    messageUid: "new",
    role: "assistant",
    content: "arrived later",
  });
  await commitSummaryCheckpoint(input);
  assert.deepEqual(payloads[1], payloads[0]);
  assert.deepEqual(
    runtime.currentTurnMessages.readPendingChanges().entries.map(({ messageUid }) => messageUid),
    ["new"],
  );
});
