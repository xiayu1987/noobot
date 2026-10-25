/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MemoryPostProcessService } from "../../src/bot/execution/memory-postprocess.js";
import { createMemoryPostprocessIdentity } from "@noobot/session-protocol/turn-scope-identity";

function createHarness({ maybeSummarize = async () => {}, captureDialogToShortMemory } = {}) {
  const persistenceScope = { scopeId: "scope-1" };
  const messages = [{ role: "user", content: "hi", dialogProcessId: "d1" }];
  const turnReads = [];
  const captures = [];
  const executionLogs = [];
  const summarizeCalls = [];
  let resolveSummarized;
  const summarized = new Promise((resolve) => {
    resolveSummarized = resolve;
  });
  const service = new MemoryPostProcessService({
    globalConfig: {},
    session: {
      async getSessionTurns(payload) {
        turnReads.push(payload);
        return messages;
      },
      async appendExecutionLog(record) {
        executionLogs.push(record);
        if (record.event === "memory_summary_checked") resolveSummarized();
      },
    },
    memory: {
      async captureDialogToShortMemory(payload) {
        captures.push(payload);
        if (captureDialogToShortMemory) return captureDialogToShortMemory(payload);
        return true;
      },
      async maybeSummarize(payload) {
        summarizeCalls.push(payload);
        return maybeSummarize(payload);
      },
    },
    errorLogger: null,
  });
  return {
    service,
    persistenceScope,
    messages,
    turnReads,
    captures,
    executionLogs,
    summarizeCalls,
    summarized,
  };
}

const RUN = Object.freeze({
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "p1",
  dialogProcessId: "d1",
  userConfig: {},
  mode: "sync",
});

test("memory-postprocess reads turns through the session facade with the run persistence scope", async () => {
  const harness = createHarness();
  await harness.service.runMemoryPostProcessFlow({
    ...RUN,
    persistenceScope: harness.persistenceScope,
  });
  await harness.summarized;

  assert.deepEqual(harness.turnReads, [
    { userId: "u1", sessionId: "s1", persistenceScope: harness.persistenceScope },
  ]);
  assert.deepEqual(harness.captures, [
    {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "p1",
      dialogProcessId: "d1",
      messages: harness.messages,
    },
  ]);
});

test("memory-postprocess writes every memory event into its own execution turn, never the source turn", async () => {
  const harness = createHarness();
  await harness.service.runMemoryPostProcessFlow({
    ...RUN,
    persistenceScope: harness.persistenceScope,
  });
  await harness.summarized;

  const identity = createMemoryPostprocessIdentity({
    sessionId: "s1",
    sourceDialogProcessId: "d1",
  });
  assert.deepEqual(
    harness.executionLogs.map((record) => record.event),
    ["short_memory_captured", "memory_summary_scheduled", "memory_summary_checked"],
  );
  for (const record of harness.executionLogs) {
    assert.equal(record.dialogProcessId, identity.dialogProcessId);
    assert.equal(record.turnScopeId, identity.turnScopeId);
    assert.equal(record.persistenceScope, harness.persistenceScope);
  }
  assert.equal(harness.summarizeCalls.length, 1);
  assert.deepEqual(harness.summarizeCalls[0].invocationIdentity, identity);
});

test("memory-postprocess records capture failure on the memory turn and rethrows", async () => {
  const captureError = new Error("capture failed");
  const harness = createHarness({
    captureDialogToShortMemory: async () => {
      throw captureError;
    },
  });
  await assert.rejects(
    harness.service.runMemoryPostProcessFlow({
      ...RUN,
      persistenceScope: harness.persistenceScope,
    }),
    captureError,
  );
  assert.deepEqual(
    harness.executionLogs.map((record) => record.event),
    ["memory_postprocess_failed"],
  );
  assert.match(harness.executionLogs[0].dialogProcessId, /^mem_[0-9a-f]{32}$/);
  assert.equal(harness.summarizeCalls.length, 0);
});
