/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { bindCurrentTurnPersistence } from "../../../src/bot/execution/runner/current-turn-persistence.js";

const identity = { sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" };
const message = {
  ...identity,
  messageUid: "m1",
  role: "assistant",
  content: "body",
  activityTimeline: [{ eventId: "event-1" }],
};
const receipt = () => createMessagePersistenceReceipt(message, 1, "test-content-m1-1");

for (const [name, invalid] of [
  ["missing", () => []],
  ["duplicate", () => [receipt(), receipt()]],
  ["foreign message", () => [{ ...receipt(), messageUid: "foreign" }]],
  ["foreign session", () => [{ ...receipt(), sessionId: "foreign" }]],
  ["foreign dialog", () => [{ ...receipt(), dialogProcessId: "foreign" }]],
  ["foreign turn", () => [{ ...receipt(), turnScopeId: "foreign" }]],
  ["missing activity", () => [{ ...receipt(), activityEventIds: [] }]],
  ["duplicate activity", () => [{ ...receipt(), activityEventIds: ["event-1", "event-1"] }]],
  ["invalid generation", () => [{ ...receipt(), generation: 0 }]],
  ["missing body version", () => [{ ...receipt(), contentReference: undefined }]],
  ["empty body version", () => [{ ...receipt(), contentReference: "" }]],
  ["body in receipt", () => [{ ...receipt(), content: "body" }]],
]) {
  test(`${name} receipt leaves the submitted revision pending and a valid retry acknowledges it`, async () => {
    const runtime = { currentTurnMessages: createCurrentTurnMessagesStore([message]) };
    let attempts = 0;
    bindCurrentTurnPersistence({
      ...identity,
      dispatchRuntime: runtime,
      appendAgentMessages: async () => (++attempts === 1 ? invalid() : [receipt()]),
    });
    await assert.rejects(runtime.persistCurrentTurnMessages());
    assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 1);
    await runtime.persistCurrentTurnMessages();
    assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
  });
}

test("validated receipts preserve the submitted body version while concurrent changes remain pending", async () => {
  const store = createCurrentTurnMessagesStore([message]);
  const runtime = { currentTurnMessages: store };
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const original = receipt();
  let attempts = 0;
  bindCurrentTurnPersistence({
    ...identity,
    dispatchRuntime: runtime,
    appendAgentMessages: async ({ messages }) => {
      if (++attempts === 1) {
        entered.resolve();
        await release.promise;
        return [original];
      }
      return [createMessagePersistenceReceipt(messages[0], 2, "next-content-version")];
    },
  });
  const first = runtime.persistCurrentTurnMessages();
  await entered.promise;
  store.updateByUid("m1", { content: "body plus concurrent content" });
  release.resolve();
  await first;
  const [pending] = store.readPendingChanges().entries;
  assert.equal(pending.message.content, "body plus concurrent content");
  assert.equal(pending.persisted.message.content, "body");
  assert.deepEqual(pending.persisted.receipt, original);
  await runtime.persistCurrentTurnMessages();
  assert.equal(store.readPendingChanges().entries.length, 0);
  store.updateByUid("m1", { summarized: true });
  const [updated] = store.readPendingChanges().entries;
  assert.equal(updated.persisted.receipt.contentReference, "next-content-version");
  assert.equal(updated.persisted.message.content, "body plus concurrent content");
});

test("failed activity verification never advances the authoritative body version", async () => {
  const store = createCurrentTurnMessagesStore([message]);
  const runtime = { currentTurnMessages: store };
  let attempts = 0;
  bindCurrentTurnPersistence({
    ...identity,
    dispatchRuntime: runtime,
    appendAgentMessages: async () => {
      if (++attempts === 1) return [{ ...receipt(), activityEventIds: [] }];
      return [receipt()];
    },
  });
  await assert.rejects(runtime.persistCurrentTurnMessages(), {
    code: "TIMELINE_CHECKPOINT_DURABILITY_MISMATCH",
  });
  assert.equal(store.readPendingChanges().entries[0].persisted, null);
  await runtime.persistCurrentTurnMessages();
  store.updateByUid("m1", { summarized: true });
  assert.deepEqual(store.readPendingChanges().entries[0].persisted.receipt, receipt());
});

test("summary commits cannot overtake an unacknowledged message submission", async () => {
  const store = createCurrentTurnMessagesStore([message]);
  const runtime = { currentTurnMessages: store };
  const attempts = [];
  const failure = new Error("commit outcome uncertain");
  let blocked = true;
  let summaries = 0;
  bindCurrentTurnPersistence({
    ...identity,
    dispatchRuntime: runtime,
    appendAgentMessages: async (payload) => {
      attempts.push(payload);
      if (blocked) throw failure;
      return [receipt()];
    },
    commitSummaryCheckpoint: async () => {
      summaries += 1;
      assert.equal(store.readPendingChanges().entries.length, 0);
      return "checkpoint";
    },
  });
  await assert.rejects(runtime.persistCurrentTurnMessages(), (error) => error === failure);
  await assert.rejects(runtime.commitSummaryCheckpoint(), (error) => error === failure);
  assert.equal(summaries, 0);
  blocked = false;
  assert.equal(await runtime.commitSummaryCheckpoint(), "checkpoint");
  assert.equal(summaries, 1);
  assert.strictEqual(attempts[0].submission, attempts[1].submission);
  assert.strictEqual(attempts[1].submission, attempts[2].submission);
});
