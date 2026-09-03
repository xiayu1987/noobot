/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { requestMainFlowSummaryCheckpoint } from "../../../src/runtime/main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../../../src/runtime/summary-checkpoint-command.js";

test("summary command is acknowledged once only after the unified checkpoint commits", async () => {
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
      toArray() {
        return [{ role: "user", content: "keep" }];
      },
    },
    async commitSummaryCheckpoint(payload) {
      calls.push(payload);
      return { committed: true };
    },
  };
  const loopState = { turnMessages: [markedMessage] };
  requestMainFlowSummaryCheckpoint(runtime, {
    source: "plugin.summary",
    summarizedMessageIds: ["m1", "runtime-prompt"],
  });

  await consumeSummaryCheckpointCommand({ runtime, loopState, turn: 3 });
  await consumeSummaryCheckpointCommand({ runtime, loopState, turn: 3 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].summaryCompletion.source, "plugin.summary");
  assert.deepEqual(loopState.turnMessages, [{ role: "user", content: "keep" }]);
  assert.equal(runtime.systemRuntime.mainFlowControlInstructions, undefined);
});

test("summary checkpoint failures expose exact unresolved identities without message content", async () => {
  const events = [];
  const runtime = {
    systemRuntime: {},
    async commitSummaryCheckpoint() {
      const error = new Error("unresolved canonical identity");
      error.requestedMessageIds = ["sm_found", "sm_missing"];
      error.resolvedMessageIds = ["sm_found"];
      error.unresolvedMessageIds = ["sm_missing"];
      throw error;
    },
  };
  requestMainFlowSummaryCheckpoint(runtime, {
    source: "plugin.summary",
    summarizedMessageIds: ["sm_found", "sm_missing"],
  });

  await assert.rejects(
    consumeSummaryCheckpointCommand({
      runtime,
      eventListener: { onEvent: (payload) => events.push(payload) },
      turn: 4,
    }),
    /unresolved canonical identity/,
  );

  const failure = events.find((item) => item.event === "summary_checkpoint_failed");
  assert.deepEqual(failure?.data?.requestedMessageIds, ["sm_found", "sm_missing"]);
  assert.deepEqual(failure?.data?.resolvedMessageIds, ["sm_found"]);
  assert.deepEqual(failure?.data?.unresolvedMessageIds, ["sm_missing"]);
  assert.equal("content" in failure.data, false);
  assert.equal(runtime.systemRuntime.mainFlowControlInstructions.length, 1);
});
