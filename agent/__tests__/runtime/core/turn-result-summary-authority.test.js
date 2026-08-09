/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  finalizeTurnMessagesBeforeReturn,
} from "../../../src/runtime/turn/turn-result-aggregator.js";

test("turn result preserves checkpoint summary state without recomputing it", () => {
  const messages = [
    { messageUid: "task-check-before-summary", summarized: false },
    { messageUid: "message-summarized-by-checkpoint", summarized: true },
  ];
  const result = finalizeTurnMessagesBeforeReturn({
    modelMessages: messages,
    turnMessageStore: {
      toArray: () => messages,
      updateWhere: () => {
        throw new Error("turn completion must not rewrite checkpoint summary state");
      },
    },
  });

  assert.deepEqual(result, messages);
  assert.equal(result[0].summarized, false);
  assert.equal(result[1].summarized, true);
});
