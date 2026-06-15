import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS,
  AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS,
  RunConfigPluginPreparer,
} from "../../../src/system-core/bot-manage/session/run-config-plugin-preparer.js";
import { createSessionPluginRuntime } from "../../../src/system-core/bot-manage/session/session-plugin-runtime-adapter.js";
import { PLUGIN_CAPABILITY } from "../../../src/system-core/plugin/capabilities.js";

function normalizeStringArray(input = []) {
  return Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function createWorkspaceService(baseDir = "/tmp/noobot-plugin-preparer") {
  return {
    getWorkspacePath(userId = "") {
      return path.join(baseDir, userId);
    },
  };
}

function createLoadedPlugins({ capability = PLUGIN_CAPABILITY.AGENT_REGISTER, register = null } = {}) {
  return {
    registry: new Map([
      [
        "test-plugin",
        {
          manifest: {
            id: "test-plugin",
            pluginKey: "test-plugin",
            capabilities: [capability],
          },
          registerNoobotPlugin: typeof register === "function" ? register : () => {},
        },
      ],
    ]),
  };
}

function createPreparer({
  globalConfig = {},
  workspaceService = createWorkspaceService(),
  loadedDynamicPlugins = { registry: new Map() },
  pluginRuntime = {},
} = {}) {
  return new RunConfigPluginPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins,
    pluginRuntime: {
      agentPluginKey: "agentPlugin",
      botPluginKey: "botPlugin",
      agentPluginSelectors: new Set(["agentPlugin"]),
      botPluginSelectors: new Set(["botPlugin"]),
      ...pluginRuntime,
    },
    normalizeStringArray,
    mergePluginOptions: (...items) =>
      items.reduce((acc, item) => ({ ...acc, ...(item && typeof item === "object" ? item : {}) }), {}),
    createPluginResolveModelMessages: () => () => [],
    createPluginResolveMessageBlock: () => () => [],
    createPluginMarkMessagesSummarized: () => async () => 0,
    createBotSubSessionRunner: () => async () => ({}),
    createGeneratedArtifactPersister: () => async () => [],
    createBotPluginScopedJsonWriter: () => async () => ({}),
    createBotPluginScopedEventLogger: () => async () => ({}),
  });
}

test("RunConfigPluginPreparer leaves agent plugin runConfig untouched when disabled", () => {
  const preparer = createPreparer();
  const runConfig = { runtimeModel: "m1" };

  const prepared = preparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig,
  });

  assert.equal(prepared, runConfig);
  assert.equal(prepared.hookManager, undefined);
});

test("createSessionPluginRuntime exposes generic plugin slots without concrete plugin aliases", () => {
  const runtime = createSessionPluginRuntime({
    descriptors: [
      {
        keyProperty: "agentPluginKey",
        selectorsProperty: "agentPluginSelectors",
        fallbackKey: "agentPlugin",
      },
      {
        keyProperty: "botPluginKey",
        selectorsProperty: "botPluginSelectors",
        fallbackKey: "botPlugin",
      },
    ],
  });

  assert.equal(runtime.agentPluginKey, "agentPlugin");
  assert.equal(runtime.botPluginKey, "botPlugin");
  assert.deepEqual([...runtime.agentPluginSelectors], ["agentPlugin"]);
  assert.deepEqual([...runtime.botPluginSelectors], ["botPlugin"]);
});

test("RunConfigPluginPreparer resolves agent plugin options with workspace basePath and safe defaults", () => {
  const preparer = createPreparer({
    workspaceService: createWorkspaceService("/tmp/noobot-preparer-base"),
  });

  const options = preparer.resolveAgentPluginOptions({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["agentPlugin"],
      plugins: {
        agentPlugin: {
          miniRunnerMaxTurns: 99,
          timeoutMs: 1000,
        },
      },
    },
  });

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.basePath, path.join("/tmp/noobot-preparer-base", "u1"));
  assert.equal(options.miniRunnerMaxTurns, AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS);
  assert.equal(options.planningGuidanceMode, "separate_model");
  assert.equal(options.timeoutMs, AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS);
  assert.equal(typeof options.resolveModelMessages, "function");
  assert.equal(typeof options.resolveMessageBlock, "function");
  assert.equal(typeof options.markMessagesSummarized, "function");
  assert.equal(typeof options.capabilityModelInvoker, "function");
});

test("RunConfigPluginPreparer resolves agent plugin options via generic runtime selectors", () => {
  const preparer = createPreparer({
    pluginRuntime: {
      agentPluginKey: "assistant-driver",
      agentPluginSelectors: new Set(["assistant-driver"]),
    },
  });

  const options = preparer.resolveAgentPluginOptions({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["assistant-driver"],
      plugins: {
        "assistant-driver": {
          miniRunnerMaxTurns: 2,
        },
      },
    },
  });

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.miniRunnerMaxTurns, 2);
});

test("RunConfigPluginPreparer registers agent plugin once", () => {
  let registerCount = 0;
  const loadedDynamicPlugins = createLoadedPlugins({
    capability: PLUGIN_CAPABILITY.AGENT_REGISTER,
    register(api = {}) {
      registerCount += 1;
      api.policy.appendDenyToolNames(["registered_tool"]);
    },
  });
  const preparer = createPreparer({ loadedDynamicPlugins });

  const first = preparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        agentPlugin: {
          enabled: true,
          mode: "on",
          denyToolNames: ["first_run_tool"],
        },
      },
    },
  });

  assert.equal(registerCount, 1);
  assert.ok(first.hookManager);
  assert.equal(first.hookManager.__noobotAgentPluginRegistered, true);
  assert.equal(first.hookManager.runtime.agentPlugin, first.plugins.agentPlugin);
  assert.deepEqual(first.toolPolicy.denyToolNames, ["registered_tool"]);

  const second = preparer.prepareAgentPluginRunConfig({
    userId: "u1",
    runConfig: {
      ...first,
      plugins: {
        ...first.plugins,
        agentPlugin: {
          ...first.plugins.agentPlugin,
          denyToolNames: ["second_run_tool"],
        },
      },
    },
  });

  assert.equal(registerCount, 1);
  assert.equal(second.hookManager, first.hookManager);
  assert.deepEqual(second.toolPolicy.denyToolNames, [
    "registered_tool",
    "second_run_tool",
  ]);
});

test("RunConfigPluginPreparer resolves bot plugin options and injects runtime helpers", () => {
  const preparer = createPreparer({
    globalConfig: {
      plugins: {
        botPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const options = preparer.resolveBotPluginOptions({
    runConfig: {},
    userConfig: {},
  });

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.timeoutMs, undefined);
  assert.equal(options.miniRunnerMaxTurns, undefined);
  assert.equal(options.maxAutoTransitions, undefined);
  assert.equal(options.maxParallelNodeAgents, undefined);
  assert.equal(options.semanticMode, "separate_model");
  assert.equal(typeof options.resolveModelMessages, "function");
  assert.equal(typeof options.capabilityModelInvoker, "function");
  assert.equal(typeof options.subSessionRunner, "function");
  assert.equal(typeof options.generatedArtifactPersister, "function");
  assert.equal(typeof options.botPluginDialogPersister, "function");
  assert.equal(typeof options.botPluginEventLogger, "function");
});

test("RunConfigPluginPreparer resolves bot plugin options via generic runtime selectors", () => {
  const preparer = createPreparer({
    pluginRuntime: {
      botPluginKey: "task-orchestrator",
      botPluginSelectors: new Set(["task-orchestrator"]),
    },
  });

  const options = preparer.resolveBotPluginOptions({
    runConfig: {
      selectedPlugins: ["task-orchestrator"],
      plugins: {
        "task-orchestrator": {
          semanticMode: "inline",
        },
      },
    },
  });

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.semanticMode, "inline");
});

test("RunConfigPluginPreparer prepares bot plugin botHookManager", () => {
  let registerCount = 0;
  const preparer = createPreparer({
    loadedDynamicPlugins: createLoadedPlugins({
      capability: PLUGIN_CAPABILITY.BOT_REGISTER,
      register() {
        registerCount += 1;
      },
    }),
    globalConfig: {
      plugins: {
        botPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const disabled = preparer.resolveBotPluginOptions({
    runConfig: {
      plugins: {
        botPlugin: {
          enabled: false,
          mode: "off",
        },
      },
    },
  });
  assert.deepEqual(disabled, { enabled: false, mode: "off" });

  const prepared = preparer.prepareBotPluginRunConfig({
    runConfig: {
      plugins: {
        botPlugin: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  assert.ok(prepared.botHookManager);
  assert.equal(registerCount, 1);
  assert.equal(prepared.botHookManager.__noobotBotPluginRegistered, true);
  assert.equal(prepared.botHookManager.runtime.botPlugin, prepared.plugins.botPlugin);
  assert.equal(prepared.plugins.botPlugin.enabled, true);
  assert.equal(prepared.plugins.botPlugin.mode, "on");
});
