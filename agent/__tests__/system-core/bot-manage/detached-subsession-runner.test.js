import test from "node:test";
import assert from "node:assert/strict";

import { createDetachedSubSessionRunner } from "../../../src/system-core/bot-manage/session/detached-subsession-runner.js";
import { CALLER_ROLE } from "../../../src/system-core/bot-manage/config/constants.js";

function createDefaultDeps(overrides = {}) {
  const calls = {
    mergePayload: null,
    prepareRunConfigPayload: null,
    prepareAgentTurnExecutionPayload: null,
    runTurnPayload: null,
    resolvePluginScopedDirPayload: null,
    persistDetachedSubSessionSnapshotPayload: null,
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
      return { outputDir: payload.outputDir };
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
    attachmentMetas: [{ attachmentId: "att1" }],
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
  assert.equal(buildContextPayload.mode, "initial");
  assert.equal(buildContextPayload.userId, "u1");
  assert.equal(buildContextPayload.sessionId, "sub1");
  assert.equal(buildContextPayload.caller, CALLER_ROLE.BOT);
  assert.equal(buildContextPayload.parentSessionId, "parent1");
  assert.equal(buildContextPayload.dialogProcessId, "parent-dialog");
  assert.deepEqual(buildContextPayload.inputAttachmentMetas, [{ attachmentId: "att1" }]);
  assert.equal(buildContextPayload.attachmentMetas, undefined);
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
    attachmentMetas: [{ attachmentId: "att1" }],
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
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages[2].inputAttachmentMetas,
    [{ attachmentId: "att1" }],
  );
  assert.equal(
    calls.persistDetachedSubSessionSnapshotPayload.sessionPayload.messages[2].attachmentMetas,
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
