/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";
import { createRunner } from "./session-execution-runner-agent-done-order.fixtures.js";

const input = { userId: "u1", sessionId: "s1", message: "hello" };

test("runSession waits for post-run hook events before completing and publishing parent success", async () => {
  const writeStarted = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  const records = [];
  const states = [];
  const parentUpdates = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        if (
          record.event === "bot_hook_end" &&
          record.data.point === HOOK_POINT.BOT.AFTER_SESSION_RUN
        ) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        records.push(record);
      },
    },
    upstream: {
      onEvent({ event, data }) {
        if (event === "agent_lifecycle_state_changed") states.push(data.state);
      },
    },
  });
  const runner = createRunner({
    callOrder: [],
    eventListener: listener,
    runConfig: { botHookManager: createHookManager() },
    finalizeRunSession: async () => ({ answer: "done" }),
  });
  runner.upsertParentAsyncTask = ({ patch }) => parentUpdates.push(patch);
  let returned = false;
  const completion = runner.runSession(input).then((result) => {
    returned = true;
    return result;
  });
  await writeStarted.promise;
  assert.equal(returned, false);
  assert.equal(states.includes("completed"), false);
  assert.deepEqual(parentUpdates, []);
  releaseWrite.resolve();
  const result = await completion;
  assert.equal(result.lifecycle.state, "completed");
  assert.equal(parentUpdates.length, 1);
  assert.equal(parentUpdates[0].status, "completed");
  assert.deepEqual(parentUpdates[0].result, result);
  assert.equal(records.at(-1).data.state, "completed");
  assert.equal(
    records.some((record) => record.event === "agent_done"),
    false,
  );
});

test("post-run hook failure never publishes completed and drains the failed lifecycle", async () => {
  const records = [];
  const parentUpdates = [];
  const hookError = new Error("post-run hook failed");
  const hookManager = createHookManager();
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        records.push(record);
      },
    },
  });
  const runner = createRunner({
    callOrder: [],
    eventListener: listener,
    runConfig: {
      botHookManager: {
        async emit(point, ...args) {
          if (point === HOOK_POINT.BOT.AFTER_SESSION_RUN) throw hookError;
          return hookManager.emit(point, ...args);
        },
      },
    },
    finalizeRunSession: async () => ({ answer: "done" }),
  });
  runner.upsertParentAsyncTask = ({ patch }) => parentUpdates.push(patch);
  await assert.rejects(runner.runSession(input), { message: hookError.message });
  const states = records
    .filter((record) => record.event === "agent_lifecycle_state_changed")
    .map((record) => record.data.state);
  assert.equal(states.includes("completed"), false);
  assert.equal(states.at(-1), "failed");
  assert.deepEqual(
    parentUpdates.map((patch) => patch.status),
    ["failed"],
  );
  assert.equal(records.at(-1).data.point, HOOK_POINT.BOT.SESSION_RUN_ERROR);
});

test("completion event persistence failure rejects the run without parent success", async () => {
  const records = [];
  const parentUpdates = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        if (record.event === "agent_lifecycle_state_changed" && record.data.state === "completed") {
          throw new Error("completion write failed");
        }
        records.push(record);
      },
    },
  });
  const runner = createRunner({
    callOrder: [],
    eventListener: listener,
    finalizeRunSession: async () => ({ answer: "done" }),
  });
  runner.upsertParentAsyncTask = ({ patch }) => parentUpdates.push(patch);
  await assert.rejects(runner.runSession(input), /completion write failed/);
  assert.deepEqual(
    parentUpdates.map((patch) => patch.status),
    ["failed"],
  );
  assert.equal(records.at(-1).data.state, "failed");
});

test("failed runs drain error-hook events before disposing the plugin activation scope", async () => {
  const writeStarted = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  const executionError = new Error("model failed");
  let disposed = false;
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        if (
          record.event === "bot_hook_end" &&
          record.data.point === HOOK_POINT.BOT.SESSION_RUN_ERROR
        ) {
          writeStarted.resolve();
          await releaseWrite.promise;
        }
      },
    },
  });
  const runner = createRunner({
    callOrder: [],
    eventListener: listener,
    runConfig: {
      botHookManager: createHookManager(),
      pluginActivationScope: {
        dispose() {
          disposed = true;
        },
      },
    },
    agentRunner: async () => {
      throw executionError;
    },
  });
  let rejected = false;
  const failure = assert
    .rejects(runner.runSession(input), { message: executionError.message })
    .then(() => {
      rejected = true;
    });
  await writeStarted.promise;
  assert.equal(disposed, false);
  assert.equal(rejected, false);
  releaseWrite.resolve();
  await failure;
  assert.equal(disposed, true);
});

test("parent task stores the completed result without storing its own container", async () => {
  const container = {};
  const runner = createRunner({
    callOrder: [],
    finalizeRunSession: async () => ({ answer: "done" }),
  });
  runner.ensureParentAsyncResultContainer = () => container;
  runner.upsertParentAsyncTask = ({ parentAsyncResultContainer, patch }) => {
    parentAsyncResultContainer.task = patch;
  };
  const result = await runner.runSession({ ...input, parentAsyncResultContainer: container });
  assert.equal(result.parentAsyncResultContainer, container);
  assert.equal(container.task.result.parentAsyncResultContainer, undefined);
  assert.equal(container.task.result.lifecycle.state, "completed");
  assert.doesNotThrow(() => JSON.stringify(result));
});
