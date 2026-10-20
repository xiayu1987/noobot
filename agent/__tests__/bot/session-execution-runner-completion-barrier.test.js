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

const input = { userId: "u1", sessionId: "s1", message: "hello", turnScopeId: "turn-default" };

test("runSession waits for post-run hook events before completing and publishing success", async () => {
  const writeStarted = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  const records = [];
  const states = [];
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
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "turn-default",
    dialogProcessId: "dialog-1",
    persistenceScope: null,
  });
  const runner = createRunner({
    callOrder: [],
    eventListener: listener,
    runConfig: { botHookManager: createHookManager() },
    finalizeRunSession: async () => ({ answer: "done" }),
  });
  let returned = false;
  const completion = runner.runAcceptedSession(input).then((result) => {
    returned = true;
    return result;
  });
  await writeStarted.promise;
  assert.equal(returned, false);
  assert.equal(states.includes("completed"), false);
  releaseWrite.resolve();
  const result = await completion;
  assert.equal(result.lifecycle.state, "completed");
  assert.equal(records.at(-1).data.state, "completed");
  assert.equal(
    records.some((record) => record.event === "agent_done"),
    false,
  );
});

test("post-run hook failure never publishes completed and drains the failed lifecycle", async () => {
  const records = [];
  const hookError = new Error("post-run hook failed");
  const hookManager = createHookManager();
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        records.push(record);
      },
    },
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "turn-default",
    dialogProcessId: "dialog-1",
    persistenceScope: null,
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
  await assert.rejects(runner.runAcceptedSession(input), { message: hookError.message });
  const states = records
    .filter((record) => record.event === "agent_lifecycle_state_changed")
    .map((record) => record.data.state);
  assert.equal(states.includes("completed"), false);
  assert.equal(states.at(-1), "failed");
  assert.equal(records.at(-1).data.point, HOOK_POINT.BOT.SESSION_RUN_ERROR);
});

test("completion event persistence failure rejects the run as failed", async () => {
  const records = [];
  const listener = createExecutionEventListener({
    sessionManager: {
      async appendExecutionLog(record) {
        if (record.event === "agent_lifecycle_state_changed" && record.data.state === "completed") {
          throw new Error("completion write failed");
        }
        records.push(record);
      },
    },
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "turn-default",
    dialogProcessId: "dialog-1",
    persistenceScope: null,
  });
  const runner = createRunner({
    callOrder: [],
    eventListener: listener,
    finalizeRunSession: async () => ({ answer: "done" }),
  });
  await assert.rejects(runner.runAcceptedSession(input), /completion write failed/);
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
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "turn-default",
    dialogProcessId: "dialog-1",
    persistenceScope: null,
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
    .rejects(runner.runAcceptedSession(input), { message: executionError.message })
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
