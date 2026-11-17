/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MemoryPostProcessService } from "../../src/bot/execution/memory-postprocess.js";
import { createMemoryPostprocessIdentity } from "@noobot/session-protocol/turn-scope-identity";

const run = {
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "",
  dialogProcessId: "d1",
  persistenceScope: null,
  userConfig: {},
  mode: "sync",
};

function harness(appendExecutionLogs) {
  const service = new MemoryPostProcessService({
    globalConfig: {},
    now: () => "2026-01-01T00:00:00.000Z",
    session: {
      async getSessionTurns() {
        return [];
      },
      appendExecutionLogs,
    },
    memory: {
      async captureDialogToShortMemory() {},
      async maybeSummarize() {},
    },
    errorLogger: null,
  });
  const scheduled = [];
  service.scheduleMemorySummarizeFlow = (payload) => scheduled.push(payload);
  return { service, scheduled };
}

test("capture does not return or schedule summary before its accepted logs are durable", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const admitted = new Promise((resolve) => {
    started = resolve;
  });
  const { service, scheduled } = harness(async () => {
    started();
    await pending;
  });
  let completed = false;
  const task = service.runMemoryPostProcessFlow(run).then(() => {
    completed = true;
  });
  await admitted;
  await new Promise(setImmediate);
  assert.equal(completed, false);
  assert.equal(scheduled.length, 0);
  release();
  await task;
  assert.equal(scheduled.length, 1);
});

test("capture persistence failure reaches the owner before summary is scheduled", async () => {
  const failure = new Error("capture log write failed");
  const { service, scheduled } = harness(async () => {
    throw failure;
  });
  await assert.rejects(service.runMemoryPostProcessFlow(run), (error) => {
    assert.equal(error.code, "EXECUTION_LOG_PERSISTENCE_FAILED");
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(scheduled.length, 0);
});

test("summary failure and log failure preserve both original errors", async () => {
  const failure = new Error("summary failed");
  const persistenceFailure = new Error("summary log write failed");
  const { service } = harness(async () => {
    throw persistenceFailure;
  });
  service.memory.maybeSummarize = async () => {
    throw failure;
  };
  const identity = createMemoryPostprocessIdentity({
    sessionId: "s1",
    sourceDialogProcessId: "d1",
  });
  const memoryEventListener = service.createMemoryEventListener({ ...run, identity });
  await assert.rejects(
    service.runMemorySummarizeFlow({ ...run, identity, memoryEventListener }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, failure);
      assert.equal(error.errors[0], failure);
      assert.equal(error.errors[1].code, "EXECUTION_LOG_PERSISTENCE_FAILED");
      assert.equal(error.errors[1].cause, persistenceFailure);
      return true;
    },
  );
});
