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
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

test("successive checkpoints keep UID work bounded by new messages and the latest evidence pair", async () => {
  const runtime = createTestRuntimeContext({
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  });
  const store = runtime.currentTurnMessages;
  const policy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  let round = 0;
  const pair = (index) => [`check-call-${index}`, `check-result-${index}`];
  const session = {
    async commitTurnSummaryCheckpoint(payload) {
      const current = pair(round);
      const previous = round === 0 ? [] : pair(round - 1);
      assert.equal(payload.expectedCheckpointRevision, round);
      assert.deepEqual(
        payload.messages.map(({ messageUid }) => messageUid),
        [`business-${round}`, ...current],
      );
      assert.deepEqual(payload.persistedMessageUids, [`business-${round}`, ...current]);
      assert.deepEqual(payload.retainedMessageUids, current);
      assert.deepEqual(payload.summarizedMessageUids, [...previous, `business-${round}`]);
      assert.equal(
        new Set([
          ...payload.persistedMessageUids,
          ...payload.retainedMessageUids,
          ...payload.summarizedMessageUids,
        ]).size,
        round === 0 ? 3 : 5,
      );
      return summaryCheckpointResult(payload, {
        committed: true,
        markedCount: previous.length + 1,
        checkpointRevision: round + 1,
      });
    },
  };

  store.toArray = () => assert.fail("checkpoint enumerated the current Turn");
  store.readSnapshot = () => assert.fail("checkpoint materialized a full snapshot");
  for (; round < 128; round += 1) {
    const [callUid, resultUid] = pair(round);
    const callId = `check-${round}`;
    store.push({ messageUid: `business-${round}`, role: "assistant", content: "work" });
    store.push({
      messageUid: callUid,
      role: "assistant",
      tool_calls: [{ id: callId, name: "task_check", contextPolicy: policy }],
    });
    store.push({
      messageUid: resultUid,
      role: "tool",
      tool_call_id: callId,
      toolName: "task_check",
      contextPolicy: policy,
      content: "continue",
    });
    await commitSummaryCheckpoint({
      session,
      turnPersister: { prepareAgentMessages: ({ messages }) => messages },
      runtime,
      userId: "u1",
      sessionId: "s1",
      dialogProcessId: "dp",
      turnScopeId: "turn",
      summaryCompletion: createSummaryCheckpointInstruction({
        source: "plugin.summary",
        summarizedMessageUids: [
          ...(round === 0 ? [] : pair(round - 1)),
          `business-${round}`,
          ...pair(round),
        ],
      }),
    });
    assert.equal(store.readCounts().messageCount, 2);
    assert.deepEqual(store.readPendingChanges().entries, []);
    assert.deepEqual(store.readCheckpointEvidenceUids(), pair(round));
    assert.equal(runtime.summaryCheckpointRevision, round + 1);
  }
});

for (const grouped of [false, true]) {
  test(`128 checkpoints retain bounded complete evidence batches (${grouped ? "shared calls and ordinary siblings" : "alternating tools and multiple results"})`, async () => {
    const runtime = createTestRuntimeContext({
      activeMessageContext: createModelContext({
        messageBlocks: { system: [], history: [], incremental: [] },
      }),
    });
    const store = runtime.currentTurnMessages;
    const policy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
    const latestBatches = new Map();
    const positions = new Map();
    let expected;
    const session = {
      async commitTurnSummaryCheckpoint(payload) {
        assert.equal(payload.expectedCheckpointRevision, expected.round);
        assert.deepEqual(
          payload.messages.map(({ messageUid }) => messageUid),
          expected.pending,
        );
        assert.deepEqual(payload.persistedMessageUids, expected.persisted);
        assert.deepEqual(payload.retainedMessageUids, expected.retained);
        assert.deepEqual(payload.summarizedMessageUids, expected.summarized);
        const work = new Set([
          ...payload.persistedMessageUids,
          ...payload.retainedMessageUids,
          ...payload.summarizedMessageUids,
        ]);
        assert.ok(work.size <= (grouped ? 11 : 17));
        return summaryCheckpointResult(payload, {
          committed: true,
          markedCount: expected.summarized.length,
          checkpointRevision: expected.round + 1,
        });
      },
    };
    store.toArray = () => assert.fail("checkpoint enumerated the current Turn");
    store.readSnapshot = () => assert.fail("checkpoint materialized a full snapshot");
    const retainedUids = () =>
      [...new Set([...latestBatches.values()].flat())].sort(
        (left, right) => positions.get(left) - positions.get(right),
      );
    for (let round = 0; round < 128; round += 1) {
      const previous = retainedUids();
      const evidenceTools = grouped ? ["task_check", "review"] : [`evidence-${round % 3}`];
      const names = grouped ? [...evidenceTools, "ordinary"] : evidenceTools;
      const calls = names.map((name, index) => ({
        id: `call-${round}-${index}`,
        name,
        ...(evidenceTools.includes(name) ? { contextPolicy: policy } : {}),
      }));
      const batch = [
        { messageUid: `batch-${round}`, role: "assistant", tool_calls: calls },
        ...calls.flatMap((call, index) =>
          Array.from({ length: grouped ? (index === 0 ? 2 : 1) : 3 }, (_, result) => ({
            messageUid: `result-${round}-${index}-${result}`,
            role: "tool",
            tool_call_id: call.id,
            toolName: call.name,
            content: "complete",
          })),
        ),
      ];
      const pending = [
        { messageUid: `business-${round}`, role: "assistant", content: "work" },
        ...batch,
      ];
      for (const message of pending) {
        positions.set(message.messageUid, positions.size);
        store.push(message);
      }
      const batchUids = batch.map(({ messageUid }) => messageUid);
      for (const tool of evidenceTools) latestBatches.set(tool, batchUids);
      const retained = retainedUids();
      const pendingUids = pending.map(({ messageUid }) => messageUid);
      const requested = [...previous, ...pendingUids];
      expected = {
        round,
        pending: pendingUids,
        persisted: [...new Set([...pendingUids, ...retained])],
        retained,
        summarized: requested.filter((uid) => !retained.includes(uid)),
      };
      await commitSummaryCheckpoint({
        session,
        turnPersister: { prepareAgentMessages: ({ messages }) => messages },
        runtime,
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dp",
        turnScopeId: "turn",
        summaryCompletion: createSummaryCheckpointInstruction({
          source: "plugin.summary",
          summarizedMessageUids: requested,
        }),
      });
      assert.equal(store.readCounts().messageCount, retained.length);
      assert.ok(retained.length <= (grouped ? 5 : 12));
      assert.deepEqual(store.readCheckpointEvidenceUids(), retained);
      assert.deepEqual(store.readPendingChanges().entries, []);
      assert.equal(runtime.summaryCheckpointRevision, round + 1);
    }
  });
}
