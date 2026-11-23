/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { summaryCheckpointResult } from "../../helpers/summary-checkpoint-result.js";
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { bindCurrentTurnPersistence } from "../../../src/bot/execution/runner/current-turn-persistence.js";
import { commitSummaryCheckpoint } from "../../../src/bot/session/summary-checkpoint-committer.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { createSummaryCheckpointInstruction } from "@noobot/context-protocol/policy/main-flow-control";

const original = { messageUid: "original", role: "assistant", content: "before" };

for (const [name, remove] of [
  ["replacement", (store) => store.replaceAll([])],
  ["indexed rename", (store) => store.updateByUid("original", { messageUid: "renamed" })],
  ["batch rename", (store) => store.updateWhere({ messageUid: "renamed" })],
  ["committed eviction", (store) => store.evictCommittedByUids(["original"])],
]) {
  test(`${name} cancels local writes and cannot acknowledge a reintroduced UID`, () => {
    const store = createCurrentTurnMessagesStore([original]);
    const captured = store.readPendingChanges().entries;
    const selected = store.readMessageRevisions(["original"]);
    remove(store);
    assert.ok(store.readPendingChanges().entries.every((entry) => entry.message !== null));
    assert.ok(!store.readPendingChanges().entries.some((entry) => entry.messageUid === "original"));
    assert.deepEqual(store.readUnchangedMessageUids(selected), []);
    store.push(original);
    store.acknowledgeChanges(captured);
    assert.ok(store.readPendingChanges().entries.some((entry) => entry.messageUid === "original"));
    assert.deepEqual(store.readUnchangedMessageUids(selected), []);
  });
}

test("an in-flight write survives local removal and its acknowledgement preserves reintroduction", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const durable = new Map();
  let attempts = 0;
  const runtime = { currentTurnMessages: createCurrentTurnMessagesStore([original]) };
  bindCurrentTurnPersistence({
    dispatchRuntime: runtime,
    sessionId: "s1",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    async appendAgentMessages({ messages }) {
      if (++attempts === 1) {
        entered.resolve();
        await release.promise;
      }
      for (const message of messages) durable.set(message.messageUid, message);
      return messages.map((message) =>
        createMessagePersistenceReceipt(
          {
            ...message,
            sessionId: "s1",
            dialogProcessId: "d1",
            turnScopeId: "t1",
          },
          attempts,
          `test-content-${message.messageUid}-${attempts}`,
          1,
        ),
      );
    },
  });
  const first = runtime.persistCurrentTurnMessages();
  await entered.promise;
  runtime.currentTurnMessages.replaceAll([]);
  runtime.currentTurnMessages.push({ ...original, content: "after" });
  release.resolve();
  await first;
  assert.equal(durable.get("original").content, "before");
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 1);
  await runtime.persistCurrentTurnMessages();
  assert.equal(durable.get("original").content, "after");
  runtime.currentTurnMessages.replaceAll([]);
  await runtime.persistCurrentTurnMessages();
  assert.equal(attempts, 2);
  assert.equal(durable.get("original").content, "after");
});

test("summary after local replacement persists only selected writes without requesting deletion", async () => {
  const runtime = createTestRuntimeContext({
    activeMessageContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  });
  runtime.currentTurnMessages.push(original);
  runtime.currentTurnMessages.replaceAll([
    { messageUid: "selected", role: "assistant", content: "summary source" },
  ]);
  const result = await commitSummaryCheckpoint({
    runtime,
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    turnPersister: { prepareAgentMessages: ({ messages }) => messages },
    session: {
      async commitTurnSummaryCheckpoint(payload) {
        assert.deepEqual(
          payload.messages.map((message) => message.messageUid),
          ["selected"],
        );
        assert.equal(Object.hasOwn(payload, "messageDeletion"), false);
        return summaryCheckpointResult(payload, {
          committed: true,
          markedCount: 1,
          checkpointRevision: 1,
        });
      },
    },
    summaryCompletion: createSummaryCheckpointInstruction({
      source: "plugin.summary",
      summarizedMessageUids: ["selected"],
    }),
  });
  assert.equal(result.committed, true);
  assert.deepEqual(runtime.currentTurnMessages.readPendingChanges().entries, []);
});
