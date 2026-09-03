/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { finalizeTurnMessagesBeforeReturn } from "../../../src/runtime/turn/turn-result-aggregator.js";

test("turn result aggregation does not declare the turn complete before final hooks", () => {
  const messages = [
    { messageUid: "task-check-before-summary", summarized: false },
    { messageUid: "message-summarized-by-checkpoint", summarized: true },
  ];
  const result = finalizeTurnMessagesBeforeReturn({
    modelMessages: messages,
    turnMessageStore: {
      toArray: () => messages,
      updateWhere: () => {
        throw new Error("loop result aggregation must not apply terminal policy");
      },
    },
  });

  assert.deepEqual(result, messages);
  assert.equal(result[0].summarized, false);
  assert.equal(result[1].summarized, true);
});
