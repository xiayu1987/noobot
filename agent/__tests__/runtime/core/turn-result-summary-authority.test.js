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

test("turn result applies the summary policy to the completed canonical turn", () => {
  const messages = [
    { messageUid: "task-check-before-summary", summarized: false },
    { messageUid: "message-summarized-by-checkpoint", summarized: true },
  ];
  const result = finalizeTurnMessagesBeforeReturn({
    modelMessages: messages,
    turnMessageStore: {
      toArray: () => messages,
      updateWhere: (patch = {}, matcher = null) => {
        let count = 0;
        messages.forEach((message, index) => {
          if (typeof matcher === "function" && !matcher(message, index)) return;
          Object.assign(message, patch);
          count += 1;
        });
        return count;
      },
    },
  });

  assert.deepEqual(result, messages);
  assert.equal(result[0].summarized, false);
  assert.equal(result[1].summarized, true);
});
