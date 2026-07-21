/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createDetachedSubSessionRunner,
  createDetachedTerminalReceipt,
  createScopedSubSessionEventListener,
} from "../../../src/system-core/bot-manage/session/detached-subsession-runner.js";
import { CALLER_ROLE } from "../../../src/system-core/bot-manage/config/constants.js";

function createDeps(overrides = {}) {
  const calls = {
    runSessionPayloads: [],
    persistencePayloads: [],
    mergePayload: null,
    prepareRunConfigPayload: null,
    loadedWorkspacePath: "",
    emitted: [],
  };
  const deps = {
    workspaceService: {
      getWorkspacePath(userId = "") {
        return `/tmp/workspace/${userId}`;
      },
    },
    configService: {
      async loadUserConfig(workspacePath = "") {
        calls.loadedWorkspacePath = workspacePath;
        return { userConfigLoaded: true };
      },
    },
    sessionRunner: {
      async runSession(payload = {}) {
        calls.runSessionPayloads.push(payload);
        return {
          output: "agent answer",
          traces: [{ type: "trace" }],
          turnTasks: [{ taskId: "t1" }],
          turnMessages: [{ role: "assistant", content: "agent answer" }],
          dialogProcessId: payload.dialogProcessId || "sub-dialog",
          lifecycle: { executionState: "completed" },
          session: { sessionId: payload.sessionId, version: 3, revision: 3 },
        };
      },
    },
    session: {
      createScopedPersistenceContext(payload = {}) {
        calls.persistencePayloads.push(payload);
        return Object.freeze({ locationResolver: { marker: payload.relativeDir }, metadataContributor: payload.metadataContributor });
      },
    },
    pluginRuntime: {
      agentPluginKey: "harness",
      botPluginKey: "workflow",
      agentPluginSelectors: new Set(["agentPlugin"]),
      botPluginSelectors: new Set(["botPlugin"]),
    },
    mergeRunConfigWithPluginStrategy(payload = {}) {
      calls.mergePayload = payload;
      return {
        ...payload.baseRunConfig,
        ...payload.runConfigPatch,
        disabledPlugins: payload.disabledPlugins,
        hookManager: { shouldBeDeleted: true },
        hooks: { shouldBeDeleted: true },
        botHookManager: { shouldBeDeleted: true },
        botHooks: { shouldBeDeleted: true },
      };
    },
    prepareRunConfig(payload = {}) {
      calls.prepareRunConfigPayload = payload;
      return {
        ...payload.runConfig,
        selectedPlugins: ["agentPlugin", "botPlugin"],
        plugins: {
          agentPlugin: { enabled: true, mode: "on" },
          botPlugin: { enabled: true, mode: "on" },
        },
      };
    },
  };
  return { calls, deps: { ...deps, ...overrides } };
}

function createParentContext(extra = {}) {
  return {
    userId: "u1",
    sessionId: "parent1",
    dialogProcessId: "parent-dialog",
    runConfig: { base: true },
    ...extra,
  };
}

test("detached sub-session delegates execution and persistence to the main runner", async () => {
  const { calls, deps } = createDeps();
  const events = [];
  const runner = createDetachedSubSessionRunner(deps);
  const result = await runner({
    parentContext: createParentContext(),
    message: "hello",
    attachments: [{ name: "a.txt" }],
    systemMessages: ["system"],
    runConfigPatch: { turnScopeId: "turn-1", extra: true },
    eventListener: { onEvent: (event) => events.push(event) },
    strategy: {
      sessionId: "sub1",
      parentSessionId: "parent1",
      parentDialogProcessId: "parent-dialog",
      dialogProcessId: "sub-dialog",
      turnScopeId: "turn-1",
      executionId: "agent:turn-1",
      parentExecutionId: "workflow:root",
      rootExecutionId: "workflow:root",
      disabledPlugins: ["workflow"],
      relativeDir: "runtime/workflow/session/root/node-a",
      allowedRoot: "runtime/workflow/session",
    },
    metadata: { scope: "workflow_node", nodeId: "n1" },
  });

  assert.equal(calls.runSessionPayloads.length, 1);
  const payload = calls.runSessionPayloads[0];
  assert.equal(payload.userId, "u1");
  assert.equal(payload.sessionId, "sub1");
  assert.equal(payload.parentSessionId, "parent1");
  assert.equal(payload.parentDialogProcessId, "parent-dialog");
  assert.equal(payload.caller, CALLER_ROLE.BOT);
  assert.equal(payload.message, "hello");
  assert.deepEqual(payload.attachments, [{ name: "a.txt" }]);
  assert.deepEqual(payload.systemMessages, ["system"]);
  assert.equal(payload.turnScopeId, "turn-1");
  assert.equal(payload.runConfig.hookManager, undefined);
  assert.equal(payload.runConfig.hooks, undefined);
  assert.equal(payload.runConfig.botHookManager, undefined);
  assert.equal(payload.runConfig.botHooks, undefined);
  assert.deepEqual(payload.runConfig.disabledPlugins, ["workflow"]);
  assert.equal(payload.runConfig.executionId, "agent:turn-1");
  assert.equal(payload.runConfig.executionKind, "agent");
  assert.equal(payload.runConfig.parentExecutionId, "workflow:root");
  assert.equal(payload.runConfig.rootExecutionId, "workflow:root");
  assert.equal(payload.runConfig.systemRuntimePatch.durableParentSessionId, "parent1");
  assert.equal(payload.parentAsyncResultContainer, null);
  assert.ok(payload.persistenceContext);

  assert.equal(calls.persistencePayloads.length, 1);
  assert.deepEqual(calls.persistencePayloads[0], {
    userId: "u1",
    relativeDir: "runtime/workflow/session/root/node-a",
    allowedRoot: "runtime/workflow/session",
    metadataContributor: calls.persistencePayloads[0].metadataContributor,
  });
  const metadata = calls.persistencePayloads[0].metadataContributor();
  assert.equal(metadata.scope, "workflow_node");
  assert.equal(metadata.nodeId, "n1");
  assert.equal(metadata.sessionId, "sub1");
  assert.equal(metadata.runtimePluginState.scope, "detached_sub_session");
  assert.equal(events.some((event) => event?.event === "plugin_runtime_resolved"), true);

  assert.equal(result.sessionId, "sub1");
  assert.equal(result.parentSessionId, "parent1");
  assert.equal(result.dialogProcessId, "sub-dialog");
  assert.equal(result.persisted.version, 3);
  assert.equal(result.lifecycle.executionState, "completed");
  assert.equal(result.result.answer, "agent answer");
  assert.deepEqual(result.result.messages, [{ role: "assistant", content: "agent answer" }]);
  assert.deepEqual(result.result.turnTasks, [{ taskId: "t1" }]);
});

test("detached sub-session propagates main runner abort and failure contracts", async () => {
  const abortError = new Error("stopped");
  abortError.name = "AbortError";
  const { deps } = createDeps({
    sessionRunner: {
      async runSession() {
        throw abortError;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({
      parentContext: createParentContext(),
      strategy: {
        sessionId: "sub1",
        relativeDir: "runtime/workflow/session/root/node-a",
        allowedRoot: "runtime/workflow/session",
      },
    }),
    (error) => error === abortError,
  );
});

test("detached terminal receipt adapts persisted Agent success and failure states", () => {
  const completed = createDetachedTerminalReceipt({
    executionId: "agent:child-1",
    lifecycle: { state: "completed", executionId: "agent:child-1", revision: 5, sequence: 5 },
  });
  assert.deepEqual(completed, {
    state: "completed",
    executionId: "agent:child-1",
    executionKind: "agent",
    revision: 5,
    sequence: 5,
    failure: null,
  });

  const failed = createDetachedTerminalReceipt({
    executionId: "agent:child-1",
    failed: true,
    lifecycle: {
      state: "failed",
      executionId: "agent:child-1",
      revision: 4,
      sequence: 4,
      error: "model failed",
    },
  });
  assert.equal(failed.state, "processing_failed");
  assert.deepEqual(failed.failure, { code: "CHILD_EXECUTION_FAILED", message: "model failed" });
});

test("createDetachedSubSessionRunner requires userId and parentSessionId", async () => {
  const { deps } = createDeps();
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({ parentContext: { userId: "u1" } }),
    /sub-session runner requires userId and parentSessionId/,
  );
});

test("createDetachedSubSessionRunner aborts before execution when signal is already aborted", async () => {
  let runCalled = false;
  const controller = new AbortController();
  controller.abort();
  const { deps } = createDeps({
    sessionRunner: {
      async runSession() {
        runCalled = true;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({ parentContext: createParentContext(), abortSignal: controller.signal }),
    /bot plugin sub-session aborted/,
  );
  assert.equal(runCalled, false);
});

test("createDetachedSubSessionRunner falls back to empty userConfig when loading config fails", async () => {
  const { calls, deps } = createDeps({
    configService: {
      async loadUserConfig() {
        throw new Error("config unavailable");
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await runner({
    parentContext: createParentContext(),
    strategy: {
      sessionId: "sub1",
      relativeDir: "runtime/workflow/session/root/node-a",
      allowedRoot: "runtime/workflow/session",
    },
  });
  assert.deepEqual(calls.prepareRunConfigPayload.userConfig, {});
});

test("createScopedSubSessionEventListener injects child session coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent: (event) => received.push(event) },
    {
      userId: "u1",
      sessionId: "sub1",
      parentSessionId: "parent1",
      dialogProcessId: "dialog1",
      turnScopeId: "turn1",
    },
  );
  listener.onEvent({ type: "model_delta", data: { content: "x" } });
  assert.deepEqual(received[0].data, {
    content: "x",
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    dialogProcessId: "dialog1",
    turnScopeId: "turn1",
  });
});

test("createScopedSubSessionEventListener preserves explicit event coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent: (event) => received.push(event) },
    { userId: "fallback-user", sessionId: "fallback-session" },
  );
  listener.onEvent({
    type: "model_delta",
    data: {
      userId: "u2",
      sessionId: "sub2",
      parentSessionId: "parent2",
      dialogProcessId: "dialog2",
      turnScopeId: "turn2",
    },
  });
  assert.equal(received[0].data.userId, "u2");
  assert.equal(received[0].data.sessionId, "sub2");
});

test("createScopedSubSessionEventListener returns null without a listener", () => {
  assert.equal(createScopedSubSessionEventListener(null, { sessionId: "sub1" }), null);
});
