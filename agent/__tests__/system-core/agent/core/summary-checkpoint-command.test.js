/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { requestMainFlowSummaryCheckpoint } from "../../../../src/system-core/agent/core/main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../../../../src/system-core/agent/core/summary-checkpoint-command.js";

test("summary command is consumed once and enters the unified checkpoint after marking", async () => {
  const markedMessage = {
    role: "assistant",
    content: "old tool call",
    summarized: true,
    additional_kwargs: { noobotMessageId: "m1" },
  };
  const calls = [];
  const runtime = {
    systemRuntime: {},
    currentTurnMessages: {
      toArray() { return [{ role: "user", content: "keep" }]; },
    },
    async commitSummaryCheckpoint(payload) {
      calls.push(payload);
      assert.equal(markedMessage.summarized, true, "notification must happen after marking");
      return { committed: true };
    },
  };
  const loopState = { turnMessages: [markedMessage] };
  requestMainFlowSummaryCheckpoint(runtime, {
    source: "plugin.summary",
    summarizedMessageIds: ["m1"],
    summarizedMessages: [markedMessage],
  });

  await consumeSummaryCheckpointCommand({ runtime, loopState, turn: 3 });
  await consumeSummaryCheckpointCommand({ runtime, loopState, turn: 3 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].summaryCompletion.source, "plugin.summary");
  assert.deepEqual(loopState.turnMessages, [{ role: "user", content: "keep" }]);
  assert.equal(runtime.systemRuntime.mainFlowControlInstructions, undefined);
});
