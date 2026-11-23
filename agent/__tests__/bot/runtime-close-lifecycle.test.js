/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AsyncResource } from "node:async_hooks";
import { PendingOperations } from "../../src/shared/pending-operations.js";
import { BotManager } from "../../src/bot/index.js";
import { createTestSessionExecutionEngine } from "../helpers/session-execution-engine.js";

function deferred() {
  const { promise, resolve } = Promise.withResolvers();
  return { promise, resolve };
}

test("draining rejects new roots but lets admitted work finish its child operations", async () => {
  const tasks = new PendingOperations();
  const gate = deferred();
  const child = deferred();
  const work = tasks.run(async () => {
    await gate.promise;
    return tasks.run(async () => {
      await child.promise;
      return "done";
    });
  });
  let closed = false;
  const closing = tasks.close().then(() => {
    closed = true;
  });
  await assert.rejects(
    tasks.run(() => assert.fail("new work admitted")),
    { code: "RUNTIME_CLOSED" },
  );
  gate.resolve();
  await new Promise(setImmediate);
  assert.equal(closed, false);
  child.resolve();
  assert.equal(await work, "done");
  await closing;
  assert.equal(tasks.active, 0);
});

test("operation failure reaches its caller and does not prevent shutdown", async () => {
  const tasks = new PendingOperations();
  const failure = new Error("operation failed");
  await assert.rejects(
    tasks.run(() => {
      throw failure;
    }),
    (cause) => cause === failure,
  );
  await tasks.close();
});

test("a callback inherited from a completed operation cannot reopen a drained runtime", async () => {
  const tasks = new PendingOperations();
  let late;
  await tasks.run(async () => {
    late = AsyncResource.bind(() => tasks.run(() => assert.fail("stale work admitted")));
  });
  await tasks.close();
  await assert.rejects(late(), { code: "RUNTIME_CLOSED" });
});

test("Bot shutdown waits for the engine, then asynchronous capture and summary before storage closes", async () => {
  const engine = createTestSessionExecutionEngine();
  const execution = deferred();
  const capture = deferred();
  const summary = deferred();
  const summaryStarted = deferred();
  engine.runner.runSession = async () => {
    await execution.promise;
    void engine.memoryPostProcessService.runMemoryPostProcessFlow({ userId: "u1" });
    return "finished";
  };
  engine.memoryPostProcessService.capture = async () => {
    await capture.promise;
    engine.memoryPostProcessService.scheduleMemorySummarizeFlow({ userId: "u1", sessionId: "s1" });
  };
  engine.memoryPostProcessService.summarize = async () => {
    summaryStarted.resolve();
    await summary.promise;
  };
  let storageClosed = false;
  const bot = Object.assign(Object.create(BotManager.prototype), {
    sessionRunner: engine,
    sessionRuntime: {
      async close() {
        storageClosed = true;
      },
    },
  });
  const running = bot.runSession({ userId: "u1" });
  const closing = bot.close();
  await assert.rejects(bot.runSession({ userId: "u1" }), { code: "RUNTIME_CLOSED" });
  execution.resolve();
  assert.equal(await running, "finished");
  assert.equal(storageClosed, false);
  capture.resolve();
  await summaryStarted.promise;
  assert.equal(storageClosed, false);
  summary.resolve();
  await closing;
  assert.equal(storageClosed, true);
  await assert.rejects(engine.memoryPostProcessService.runMemoryPostProcessFlow({ userId: "u1" }), {
    code: "RUNTIME_CLOSED",
  });
});
