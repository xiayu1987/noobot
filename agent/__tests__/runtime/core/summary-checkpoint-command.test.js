/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import test from "node:test";
import assert from "node:assert/strict";

import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  peekMainFlowSummaryCheckpoint,
  requestMainFlowSummaryCheckpoint,
} from "../../../src/runtime/main-flow-control.js";
import { consumeSummaryCheckpointCommand } from "../../../src/runtime/summary-checkpoint-command.js";

test("summary command is acknowledged once only after the unified checkpoint commits", async () => {
  const calls = [];
  const runtime = createTestRuntimeContext({
    systemRuntime: {},
    async commitSummaryCheckpoint(payload) {
      calls.push(payload);
      return { committed: true };
    },
  });
  runtime.currentTurnMessages.push({ role: "user", content: "keep", messageUid: "m-keep" });
  requestMainFlowSummaryCheckpoint(runtime, {
    source: "plugin.summary",
    summarizedMessageUids: ["m1", "runtime-prompt"],
  });

  await consumeSummaryCheckpointCommand({ runtime, eventListener: null, turn: 3 });
  await consumeSummaryCheckpointCommand({ runtime, eventListener: null, turn: 3 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].summaryCompletion.source, "plugin.summary");
  assert.deepEqual(runtime.currentTurnMessages.toArray(), [
    { role: "user", content: "keep", messageUid: "m-keep" },
  ]);
  assert.equal(peekMainFlowSummaryCheckpoint(runtime), null);
});

test("summary checkpoint failures expose exact unresolved identities without message content", async () => {
  const events = [];
  const runtime = createTestRuntimeContext({
    systemRuntime: {},
    async commitSummaryCheckpoint() {
      const error = new Error("unresolved canonical identity");
      error.code = SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING;
      error.messageUidResolution = {
        requestedMessageUids: ["sm_found", "sm_missing"],
        resolvedMessageUids: ["sm_found"],
        unresolvedMessageUids: ["sm_missing"],
      };
      throw error;
    },
  });
  requestMainFlowSummaryCheckpoint(runtime, {
    source: "plugin.summary",
    summarizedMessageUids: ["sm_found", "sm_missing"],
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
  assert.deepEqual(failure?.data?.summarizedMessageUids, ["sm_found", "sm_missing"]);
  assert.deepEqual(failure?.data?.messageUidResolution, {
    requestedMessageUids: ["sm_found", "sm_missing"],
    resolvedMessageUids: ["sm_found"],
    unresolvedMessageUids: ["sm_missing"],
  });
  assert.equal("content" in failure.data, false);
  assert.notEqual(peekMainFlowSummaryCheckpoint(runtime), null);
});
