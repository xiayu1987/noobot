/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildLoopResult } from "../../../src/runtime/turn/turn-result-aggregator.js";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";

test("turn result aggregation does not declare the turn complete before final hooks", () => {
  const turnMessageStore = createCurrentTurnMessagesStore([
    { role: "assistant", messageUid: "task-check-before-summary", summarized: false },
    { role: "assistant", messageUid: "message-summarized-by-checkpoint", summarized: true },
  ]);
  turnMessageStore.updateWhere = () => {
    throw new Error("loop result aggregation must not apply terminal policy");
  };
  const result = buildLoopResult({
    output: "",
    modelMessageId: "model-final",
    traces: [],
    loopState: { systemRuntime: { modelLoopRound: 2 } },
    turnMessageStore,
    modelMessages: [],
  });

  assert.deepEqual(
    result.turnMessages.map(({ messageUid, summarized }) => ({ messageUid, summarized })),
    [
      { messageUid: "task-check-before-summary", summarized: false },
      { messageUid: "message-summarized-by-checkpoint", summarized: true },
    ],
  );
  assert.equal(result.modelLoopRound, 2);
});

test("result selection reads only pending messages and the final assistant after checkpoint acknowledgement", () => {
  const turnMessageStore = createCurrentTurnMessagesStore();
  for (let index = 0; index < 10000; index += 1) {
    turnMessageStore.push({ messageUid: `tool-${index}`, role: "tool", content: "archived" });
  }
  turnMessageStore.push({ messageUid: "committed-final", role: "assistant", content: "final" });
  turnMessageStore.acknowledgeChanges(turnMessageStore.readPendingChanges().entries);
  turnMessageStore.toArray = () =>
    assert.fail("result aggregation must not copy the complete turn");
  turnMessageStore.push({ messageUid: "pending-tool", role: "tool", content: "delta" });
  const result = buildLoopResult({
    output: "final",
    modelMessageId: "model-final",
    traces: [],
    loopState: { systemRuntime: { modelLoopRound: 10000 } },
    turnMessageStore,
    modelMessages: [],
  });
  assert.deepEqual(
    result.turnMessages.map((message) => message.messageUid),
    ["committed-final", "pending-tool"],
  );
  assert.equal(turnMessageStore.readCounts().messageCount, 10002);
  result.turnMessages[0].content = "hook output";
  assert.equal(turnMessageStore.readByUid("committed-final").content, "final");
});

test("result selection tracks changed positions and does not resurrect evicted checkpoint messages", () => {
  const store = createCurrentTurnMessagesStore([
    { messageUid: "first", role: "tool" },
    { messageUid: "second", role: "tool" },
    { messageUid: "final", role: "assistant" },
  ]);
  store.acknowledgeChanges(store.readPendingChanges().entries);
  store.updateByUid("second", { summarized: true });
  store.updateByUid("first", { summarized: true });
  assert.deepEqual(
    store.readResultMessages().map((message) => message.messageUid),
    ["first", "second", "final"],
  );
  store.evictCommittedByUids(["first", "second"]);
  assert.deepEqual(
    store.readResultMessages().map((message) => message.messageUid),
    ["final"],
  );
  store.updateByUid("final", { content: "new final" });
  assert.deepEqual(
    store.readResultMessages().map((message) => message.messageUid),
    ["final"],
  );
});
