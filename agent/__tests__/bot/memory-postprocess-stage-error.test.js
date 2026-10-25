/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MemoryPostProcessService } from "../../src/bot/execution/memory-postprocess.js";
import { createMemoryPostprocessIdentity } from "@noobot/session-protocol/turn-scope-identity";

function createHarness(maybeSummarize) {
  const events = [];
  const logs = [];
  let flushCount = 0;
  const service = new MemoryPostProcessService({
    globalConfig: {},
    session: {},
    memory: { maybeSummarize },
    errorLogger: { log: async (entry) => logs.push(entry) },
  });
  const memoryEventListener = {
    onEvent: (packet) => events.push(packet),
    flush: async () => {
      flushCount += 1;
    },
  };
  return { service, events, logs, memoryEventListener, flushCount: () => flushCount };
}

test("memory-postprocess: stage failure is recorded and summary flow completes", async () => {
  const stageError = Object.assign(new Error("bad patch"), { code: "LONG_MEMORY_PATCH_INVALID" });
  const { service, events, logs, memoryEventListener, flushCount } = createHarness(
    async ({ onStageError }) => {
      await onStageError({ stage: "long_memory", error: stageError });
    },
  );

  await service.runMemorySummarizeFlow({
    userId: "u1",
    sessionId: "s1",
    identity: createMemoryPostprocessIdentity({ sessionId: "s1", sourceDialogProcessId: "d1" }),
    memoryEventListener,
    mode: "async",
  });

  const failed = events.filter((packet) => packet.event === "memory_summary_failed");
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].data, {
    sessionId: "s1",
    mode: "async",
    stage: "long_memory",
    error: "bad patch",
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].error, stageError);
  assert.deepEqual(logs[0].extra, { stage: "long_memory" });
  assert.ok(events.some((packet) => packet.event === "memory_summary_checked"));
  assert.equal(flushCount(), 1);
});
