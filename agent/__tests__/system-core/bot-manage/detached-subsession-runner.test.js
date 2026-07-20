/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createDetachedSubSessionRunner,
  createScopedSubSessionEventListener,
} from "../../../src/system-core/bot-manage/session/detached-subsession-runner.js";
import { CALLER_ROLE } from "../../../src/system-core/bot-manage/config/constants.js";

function createDefaultDeps(overrides = {}) {
  const calls = {
    mergePayload: null,
    prepareRunConfigPayload: null,
    prepareAgentTurnExecutionPayload: null,
    runTurnPayload: null,
    resolvePluginScopedDirPayload: null,
    persistDetachedSubSessionSnapshotPayload: null,
    persistDetachedSubSessionTerminalPayloads: [],
    assertDetachedSubSessionIsolationPayload: null,
    loadedWorkspacePath: "",
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
    agentRuntimeFacade: {
      async runTurn(payload = {}) {
        calls.runTurnPayload = payload;
        return {
          output: "agent answer",
          traces: [{ type: "trace" }],
          turnTasks: [{ taskId: "t1" }],
          dialogProcessId: "agent-dialog",
        };
      },
    },
    errorLogger: { name: "logger" },
    pluginRuntime: {
      agentPluginKey: "agentPlugin",
      botPluginKey: "botPlugin",
      agentPluginSelectors: new Set(["agentPlugin"]),
      botPluginSelectors: new Set(["botPlugin"]),
    },
    mergeRunConfigWithPluginStrategy(payload = {}) {
      calls.mergePayload = payload;
      return {
        ...payload.baseRunConfig,
        ...payload.runConfigPatch,
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
        hookManager: { ready: true },
        botHookManager: { ready: true },
      };
    },
    async prepareAgentTurnExecution(payload = {}) {
      calls.prepareAgentTurnExecutionPayload = payload;
      return {
        runtimeAgentContext: {
          payload: {
            runtime: {
              systemRuntime: {
                dialogProcessId: payload?.buildContextPayload?.dialogProcessId,
              },
            },
          },
        },
      };
    },
    resolvePluginScopedDir(payload = {}) {
      calls.resolvePluginScopedDirPayload = payload;
      return "";
    },
    normalizeDetachedSubSessionMessage(message = {}, now = "") {
      return {
        ...message,
        normalizedAt: now,
      };
    },
    async persistDetachedSubSessionSnapshot(payload = {}) {
      calls.persistDetachedSubSessionSnapshotPayload = payload;
      return { outputDir: payload.outputDir, version: 7 };
    },
    async persistDetachedSubSessionTerminal(payload = {}) {
      calls.persistDetachedSubSessionTerminalPayloads.push(payload);
      return { committed: true, version: 11 };
    },
    async assertDetachedSubSessionIsolation(payload = {}) {
      calls.assertDetachedSubSessionIsolationPayload = payload;
      return true;
    },
    now: () => "2026-03-04T05:06:07.000Z",
  };
  return {
    calls,
    deps: {
      ...deps,
      ...overrides,
    },
  };
}

function createLifecycleMock({ rejectFirst = false, abortOnRun = false } = {}) {
  const calls = [];
  let revision = 0;
  const applyTurnLifecycleEvent = async (payload = {}) => {
    calls.push({ ...payload });
    if (rejectFirst && calls.length === 1) {
      return { applied: false, reason: "session_not_found" };
    }
    revision += 1;
    return {
      applied: true,
      turn: {
        revision,
        sequence: revision,
        active: !["completed", "stopped", "failed"].includes(payload.executionState),
      },
    };
  };
  return { calls, applyTurnLifecycleEvent, abortOnRun };
}

test("detached sub-session provision rejection has no execution side effects", async () => {
  const lifecycle = createLifecycleMock({ rejectFirst: true });
  let prepareCount = 0;
  let runCount = 0;
  const { deps } = createDefaultDeps({
    applyTurnLifecycleEvent: lifecycle.applyTurnLifecycleEvent,
    async prepareAgentTurnExecution(payload) {
      prepareCount += 1;
      return { runtimeAgentContext: { payload } };
    },
    agentRuntimeFacade: {
      async runTurn() {
        runCount += 1;
        return {};
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    () => runner({ parentContext: { userId: "u1", sessionId: "parent1" } }),
    (error) => error?.code === "session_not_found",
  );
  assert.equal(prepareCount, 0);
  assert.equal(runCount, 0);
  assert.equal(lifecycle.calls.length, 1);
  assert.equal(lifecycle.calls[0].createSessionIfAbsent, true);
  assert.equal(lifecycle.calls[0].expectedRevision, 0);
});

test("detached sub-session lifecycle uses committed revisions and reaches completion", async () => {
  const lifecycle = createLifecycleMock();
  const runtimeEvents = [];
  const { deps } = createDefaultDeps({
    applyTurnLifecycleEvent: lifecycle.applyTurnLifecycleEvent,
  });
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentContext: { userId: "u1", sessionId: "parent1" },
    strategy: { sessionId: "child1" },
    eventListener: { onEvent: (event) => runtimeEvents.push(event) },
  });
  assert.deepEqual(
    lifecycle.calls.map((call) => call.eventType),
    ["turn.action_accepted", "turn.processing_started", "turn.processing_completed", "turn.completed"],
  );
  assert.deepEqual(
    lifecycle.calls.map((call) => call.expectedRevision),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    lifecycle.calls.map((call) => call.sequence),
    [undefined, undefined, undefined, undefined],
  );
  assert.equal(lifecycle.calls[0].createSessionIfAbsent, true);
  assert.equal(lifecycle.calls.slice(1).some((call) => call.createSessionIfAbsent), false);
  const committed = runtimeEvents.filter((event) => event.event === "turn_lifecycle_committed");
  assert.equal(committed.length, 4);
  assert.deepEqual(committed.map((event) => event.data.eventType), lifecycle.calls.map((call) => call.eventType));
  assert.equal(committed.every((event) => event.data.sessionId === "child1"), true);
  assert.equal(committed.every((event) => event.data.parentSessionId === "parent1"), true);
  assert.deepEqual(committed.map((event) => event.data.turn.revision), [1, 2, 3, 4]);
});

test("detached sub-session does not publish rejected or deduplicated lifecycle acknowledgements", async () => {
  const runtimeEvents = [];
  let callCount = 0;
  const { deps } = createDefaultDeps({
    applyTurnLifecycleEvent: async () => {
      callCount += 1;
      if (callCount === 1) return { deduplicated: true, turn: { revision: 1, sequence: 1 } };
      return { applied: false, reason: "transition_rejected" };
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  await assert.rejects(
    () => runner({
      parentContext: { userId: "u1", sessionId: "parent1" },
      eventListener: { onEvent: (event) => runtimeEvents.push(event) },
    }),
    (error) => error?.code === "transition_rejected",
  );
  assert.equal(runtimeEvents.some((event) => event.event === "turn_lifecycle_committed"), false);
});

test("detached sub-session abort uses the three stop lifecycle phases", async () => {
  const lifecycle = createLifecycleMock();
  const abortController = new AbortController();
  const { calls, deps } = createDefaultDeps({
    applyTurnLifecycleEvent: lifecycle.applyTurnLifecycleEvent,
    resolvePluginScopedDir: () => "/tmp/workflow-child-stop",
    agentRuntimeFacade: {
      async runTurn() {
        abortController.abort();
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    () => runner({
      parentContext: { userId: "u1", sessionId: "parent1" },
      strategy: { sessionId: "child-stop" },
      abortSignal: abortController.signal,
    }),
    (error) => error?.name === "AbortError",
  );
  assert.deepEqual(
    lifecycle.calls.map((call) => call.eventType),
    ["turn.action_accepted", "turn.processing_started", "turn.stop_accepted", "turn.stop_processing_completed", "turn.stop_completed"],
  );
  assert.equal(lifecycle.calls.some((call) => call.eventType === "turn.failed"), false);
  assert.ok(calls.persistDetachedSubSessionSnapshotPayload);
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.sessionId, "child-stop");
  assert.equal(
    lifecycle.calls.find((call) => call.eventType === "turn.stop_completed")?.summaryVersion,
    11,
  );
});

test("detached sub-session terminal version is independent from plugin snapshot version", async () => {
  const lifecycle = createLifecycleMock();
  const abortController = new AbortController();
  const { deps } = createDefaultDeps({
    applyTurnLifecycleEvent: lifecycle.applyTurnLifecycleEvent,
    resolvePluginScopedDir: () => "/tmp/workflow-child-stop-no-version",
    persistDetachedSubSessionSnapshot: async (payload = {}) => ({ outputDir: payload.outputDir }),
    persistDetachedSubSessionTerminal: async () => ({ committed: true, version: 13 }),
    agentRuntimeFacade: {
      async runTurn() {
        abortController.abort();
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    () => runner({
      parentContext: { userId: "u1", sessionId: "parent1" },
      strategy: { sessionId: "child-stop-no-version" },
      abortSignal: abortController.signal,
    }),
    (error) => error?.name === "AbortError",
  );
  assert.equal(
    lifecycle.calls.find((call) => call.eventType === "turn.stop_completed")?.summaryVersion,
    13,
  );
});

test("detached sub-session completion commit failure is compensated with the latest revision", async () => {
  const lifecycle = createLifecycleMock();
  const originalApply = lifecycle.applyTurnLifecycleEvent;
  let committedState = null;
  lifecycle.applyTurnLifecycleEvent = async (payload) => {
    if (payload.eventType === "turn.completed") {
      lifecycle.calls.push({ ...payload });
      return { applied: false, reason: "completion_commit_failed" };
    }
    const result = await originalApply(payload);
    committedState = result.turn;
    return result;
  };
  const { deps } = createDefaultDeps({
    applyTurnLifecycleEvent: lifecycle.applyTurnLifecycleEvent,
  });
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    () => runner({ parentContext: { userId: "u1", sessionId: "parent1" } }),
    (error) => error?.code === "completion_commit_failed",
  );
  assert.deepEqual(
    lifecycle.calls.map((call) => call.eventType),
    ["turn.action_accepted", "turn.processing_started", "turn.processing_completed", "turn.completed", "turn.failed"],
  );
  assert.equal(lifecycle.calls.at(-1).expectedRevision, 3);
  assert.equal(committedState?.active, false);
  assert.equal(lifecycle.calls.at(-1).phase, "completion");
});

test("createDetachedSubSessionRunner requires userId and parentSessionId", async () => {
  const { deps } = createDefaultDeps();
  const runner = createDetachedSubSessionRunner(deps);

  await assert.rejects(
    () => runner({ parentContext: { userId: "u1" } }),
    /sub-session runner requires userId and parentSessionId/,
  );
  await assert.rejects(
    () => runner({ parentContext: { sessionId: "p1" } }),
    /sub-session runner requires userId and parentSessionId/,
  );
});

test("createDetachedSubSessionRunner aborts before execution when signal is already aborted", async () => {
  let mergeCalled = false;
  const { deps } = createDefaultDeps({
    mergeRunConfigWithPluginStrategy() {
      mergeCalled = true;
      return {};
    },
  });
  const runner = createDetachedSubSessionRunner(deps);
  const abortController = new AbortController();
  abortController.abort();

  await assert.rejects(
    () =>
      runner({
        parentContext: { userId: "u1", sessionId: "p1" },
        abortSignal: abortController.signal,
      }),
    (error) => error?.name === "AbortError" && error?.code === "ABORT_ERR",
  );
  assert.equal(mergeCalled, false);
});

test("createDetachedSubSessionRunner prepares context, runs agent, emits runtime state, and returns fallback turn message", async () => {
  const { calls, deps } = createDefaultDeps();
  const runner = createDetachedSubSessionRunner(deps);
  const events = [];
  const bridge = { kind: "bridge" };

  const result = await runner({
    parentContext: {
      userId: "u1",
      sessionId: "parent1",
      dialogProcessId: "parent-dialog",
      userInteractionBridge: bridge,
      runConfig: {
        base: true,
        selectedPlugins: ["botPlugin"],
      },
    },
    message: "  hello bot plugin  ",
    attachments: [{ attachmentId: "att1" }],
    runConfigPatch: { patched: true, turnScopeId: "workflow-node:sub-dialog" },
    systemMessages: ["sys"],
    strategy: {
      sessionId: "sub1",
      disabledPlugins: ["agentPlugin"],
    },
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.deepEqual(calls.mergePayload, {
    baseRunConfig: { base: true, selectedPlugins: ["botPlugin"] },
    runConfigPatch: { patched: true, turnScopeId: "workflow-node:sub-dialog" },
    disabledPlugins: ["agentPlugin"],
  });
  assert.equal(calls.loadedWorkspacePath, "/tmp/workspace/u1");
  assert.equal(calls.prepareRunConfigPayload.userId, "u1");
  assert.equal(calls.prepareRunConfigPayload.userConfig.userConfigLoaded, true);
  assert.equal("hookManager" in calls.prepareRunConfigPayload.runConfig, false);
  assert.equal("hooks" in calls.prepareRunConfigPayload.runConfig, false);
  assert.equal("botHookManager" in calls.prepareRunConfigPayload.runConfig, false);
  assert.equal("botHooks" in calls.prepareRunConfigPayload.runConfig, false);

  const buildContextPayload = calls.prepareAgentTurnExecutionPayload.buildContextPayload;
  assert.equal(buildContextPayload.mode, "new_session");
  assert.equal(buildContextPayload.userId, "u1");
  assert.equal(buildContextPayload.sessionId, "sub1");
  assert.equal(buildContextPayload.caller, CALLER_ROLE.BOT);
  assert.equal(buildContextPayload.parentSessionId, "parent1");
  assert.equal(buildContextPayload.dialogProcessId, "parent-dialog");
  assert.deepEqual(buildContextPayload.userMessageAttachments, [{ attachmentId: "att1" }]);
  assert.equal(buildContextPayload.attachments, undefined);
  assert.deepEqual(buildContextPayload.systemMessages, ["sys"]);
  assert.equal(buildContextPayload.userInteractionBridge, bridge);
  assert.equal(buildContextPayload.runConfig.systemRuntimePatch.childRunParentSessionId, "parent1");
  assert.equal(buildContextPayload.runConfig.systemRuntimePatch.durableParentSessionId, "parent1");
  assert.equal(buildContextPayload.runConfig.systemRuntimePatch.detachedSessionScope, "bot_plugin_node");
  assert.equal(buildContextPayload.runConfig.turnScopeId, "workflow-node:sub-dialog");

  assert.equal(calls.runTurnPayload.errorLogger, deps.errorLogger);
  assert.equal(calls.runTurnPayload.userMessage, "hello bot plugin");
  assert.equal(events[0].event, "plugin_runtime_resolved");
  assert.equal(events[0].data.agentPlugin.enabled, true);
  assert.equal(events[0].data.agentPlugin.mode, "on");
  assert.equal(events[0].data.botPlugin.enabled, true);
  assert.equal(events[0].data.botPlugin.mode, "on");
  assert.deepEqual(events[0].data.disabledPlugins, ["agentPlugin"]);

  assert.deepEqual(calls.resolvePluginScopedDirPayload, {
    userId: "u1",
    relativeDir: "",
    absoluteDir: "",
  });
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload, null);
  assert.equal(calls.assertDetachedSubSessionIsolationPayload.userId, "u1");
  assert.equal(calls.assertDetachedSubSessionIsolationPayload.sessionId, "sub1");
  assert.equal(calls.assertDetachedSubSessionIsolationPayload.scope, "bot_plugin_node_subsession");

  assert.equal(result.userId, "u1");
  assert.equal(result.sessionId, "sub1");
  assert.equal(result.parentSessionId, "parent1");
  assert.equal(result.dialogProcessId, "agent-dialog");
  assert.equal(result.persisted, null);
  assert.equal(result.result.answer, "agent answer");
  assert.equal(result.result.caller, CALLER_ROLE.BOT);
  assert.deepEqual(result.result.messages, [
    {
      role: "assistant",
      content: "agent answer",
      type: "message",
      dialogProcessId: "agent-dialog",
    },
  ]);
  assert.deepEqual(result.result.turnTasks, [{ taskId: "t1" }]);
});


test("createDetachedSubSessionRunner inherits user interaction bridge from runtimeAgentContext", async () => {
  const { calls, deps } = createDefaultDeps();
  const runner = createDetachedSubSessionRunner(deps);
  const bridge = { requestUserInteraction: async () => ({ confirmed: true }) };

  await runner({
    parentContext: {
      userId: "u1",
      sessionId: "parent1",
      dialogProcessId: "parent-dialog",
      runtimeAgentContext: {
        execution: {
          controllers: {
            runtime: {
              userInteractionBridge: bridge,
            },
          },
        },
      },
      runConfig: {},
    },
    message: "needs user input",
    strategy: { sessionId: "sub-runtime-bridge" },
  });

  assert.equal(
    calls.prepareAgentTurnExecutionPayload.buildContextPayload.userInteractionBridge,
    bridge,
  );
});

test("createDetachedSubSessionRunner persists bot plugin sub-session snapshot when output dir resolves", async () => {
  const { calls, deps } = createDefaultDeps({
    resolvePluginScopedDir(payload = {}) {
      calls.resolvePluginScopedDirPayload = payload;
      return "/tmp/plugin/sub1";
    },
    agentRuntimeFacade: {
      async runTurn(payload = {}) {
        calls.runTurnPayload = payload;
        return {
          output: "ignored fallback",
          turnMessages: [
            {
              role: "assistant",
              content: "turn message",
              type: "message",
              dialogProcessId: "agent-dialog",
            },
          ],
          turnTasks: [{ taskId: "task1" }],
          dialogProcessId: "agent-dialog",
        };
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);

  const result = await runner({
    parentContext: {
      userId: "u1",
      sessionId: "parent1",
      dialogProcessId: "parent-dialog",
      runConfig: {},
    },
    message: "user ask",
    attachments: [{ attachmentId: "att1" }],
    systemMessages: ["sys 1", "", "sys 2"],
    strategy: {
      sessionId: "sub1",
      dialogProcessId: "sub-dialog",
      turnScopeId: "workflow-node:sub-dialog",
      relativeDir: "plugin/sub1",
    },
    metadata: {
      pluginNodeId: "node1",
    },
  });

  assert.deepEqual(calls.resolvePluginScopedDirPayload, {
    userId: "u1",
    relativeDir: "plugin/sub1",
    absoluteDir: "",
  });
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload.outputDir, "/tmp/plugin/sub1");
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.sessionId, "sub1");
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.parentSessionId, "parent1");
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.caller, CALLER_ROLE.BOT);
  assert.deepEqual(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages.map((item = {}) => item.role),
    ["system", "system", "user", "assistant"],
  );
  assert.deepEqual(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages.map((item = {}) => item.normalizedAt),
    [
      "2026-03-04T05:06:07.000Z",
      "2026-03-04T05:06:07.000Z",
      "2026-03-04T05:06:07.000Z",
      "2026-03-04T05:06:07.000Z",
    ],
  );
  assert.deepEqual(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages.map((item = {}) => item.turnScopeId),
    [
      "workflow-node:sub-dialog",
      "workflow-node:sub-dialog",
      "workflow-node:sub-dialog",
      "workflow-node:sub-dialog",
    ],
  );
  assert.equal(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages[2].content,
    "user ask",
  );
  assert.deepEqual(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages[2].userMessageAttachments,
    [{ attachmentId: "att1" }],
  );
  assert.equal(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages[2].attachments,
    undefined,
  );
  assert.deepEqual(calls.persistDetachedSubSessionSnapshotPayload.taskPayload.tasks, [
    { taskId: "task1" },
  ]);
  assert.equal(calls.persistDetachedSubSessionSnapshotPayload.taskPayload.updatedAt, "2026-03-04T05:06:07.000Z");
  assert.equal(
    calls.persistDetachedSubSessionSnapshotPayload.executionPayload.logs[0].event,
    "plugin_runtime_resolved",
  );
  assert.equal(
    calls.persistDetachedSubSessionSnapshotPayload.executionPayload.logs[0].dialogProcessId,
    "sub-dialog",
  );
  assert.equal(
    calls.persistDetachedSubSessionSnapshotPayload.executionPayload.logs[0].turnScopeId,
    "workflow-node:sub-dialog",
  );
  assert.equal(result.persisted.outputDir, "/tmp/plugin/sub1");
  assert.deepEqual(result.result.messages, [
    {
      role: "assistant",
      content: "turn message",
      type: "message",
      dialogProcessId: "agent-dialog",
    },
  ]);
});

test("createDetachedSubSessionRunner falls back to empty userConfig when loading config fails", async () => {
  const { calls, deps } = createDefaultDeps({
    configService: {
      async loadUserConfig() {
        throw new Error("config unavailable");
      },
    },
  });
  const runner = createDetachedSubSessionRunner(deps);

  await runner({
    parentContext: {
      userId: "u1",
      sessionId: "parent1",
    },
    strategy: {
      sessionId: "sub1",
    },
  });

  assert.deepEqual(calls.prepareRunConfigPayload.userConfig, {});
  assert.deepEqual(
    calls.prepareAgentTurnExecutionPayload.buildContextPayload.userConfig,
    {},
  );
});

test("createScopedSubSessionEventListener injects child session coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent: (event) => received.push(event) },
    {
      userId: "user-1",
      sessionId: "child-1",
      parentSessionId: "parent-1",
      dialogProcessId: "child-dialog-1",
      turnScopeId: "child-turn-1",
    },
  );

  listener.onEvent({ event: "tool_call", data: { toolName: "search" } });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0].data, {
    toolName: "search",
    userId: "user-1",
    sessionId: "child-1",
    parentSessionId: "parent-1",
    dialogProcessId: "child-dialog-1",
    turnScopeId: "child-turn-1",
  });
});

test("createScopedSubSessionEventListener preserves explicit event coordinates", () => {
  const received = [];
  const listener = createScopedSubSessionEventListener(
    { onEvent: (event) => received.push(event) },
    {
      userId: "fallback-user",
      sessionId: "fallback-child",
      parentSessionId: "fallback-parent",
      dialogProcessId: "fallback-dialog",
      turnScopeId: "fallback-turn",
    },
  );

  listener.onEvent({
    event: "analysis_delta",
    data: {
      userId: "event-user",
      sessionId: "event-child",
      parentSessionId: "event-parent",
      dialogProcessId: "event-dialog",
      turnScopeId: "event-turn",
      text: "hello",
    },
  });

  assert.deepEqual(received[0].data, {
    userId: "event-user",
    sessionId: "event-child",
    parentSessionId: "event-parent",
    dialogProcessId: "event-dialog",
    turnScopeId: "event-turn",
    text: "hello",
  });
});

test("createScopedSubSessionEventListener returns null without a listener", () => {
  assert.equal(
    createScopedSubSessionEventListener(null, { sessionId: "child-1" }),
    null,
  );
});
