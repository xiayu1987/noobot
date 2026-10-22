/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildLoopResult } from "../../../src/runtime/turn/turn-result-aggregator.js";
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "../../../src/runtime/turn/current-turn-ledger.js";

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
    turnTaskStore: createCurrentTurnTasksStore(),
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
