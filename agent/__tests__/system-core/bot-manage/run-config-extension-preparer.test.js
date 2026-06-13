import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { RunConfigExtensionPreparer } from "../../../src/system-core/bot-manage/session/run-config-extension-preparer.js";
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
  extensionRuntime = {},
} = {}) {
  return new RunConfigExtensionPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins,
    extensionRuntime: {
      harnessPluginKey: "harness",
      workflowPluginKey: "workflow",
      harnessPluginSelectors: new Set(["harness"]),
      workflowPluginSelectors: new Set(["workflow"]),
      ...extensionRuntime,
    },
    normalizeStringArray,
    mergeHarnessExtensionOptions: (...items) =>
      items.reduce((acc, item) => ({ ...acc, ...(item && typeof item === "object" ? item : {}) }), {}),
    createHarnessResolveModelMessages: () => () => [],
    createHarnessResolveMessageBlock: () => () => [],
    createHarnessMarkMessagesSummarized: () => async () => 0,
    createBotSubSessionRunner: () => async () => ({}),
    createGeneratedArtifactPersister: () => async () => [],
    createWorkflowScopedJsonWriter: () => async () => ({}),
    createWorkflowScopedEventLogger: () => async () => ({}),
  });
}

test("RunConfigExtensionPreparer leaves harness runConfig untouched when disabled", () => {
  const preparer = createPreparer();
  const runConfig = { runtimeModel: "m1" };

  const prepared = preparer.prepareHarnessRunConfig({
    userId: "u1",
    runConfig,
  });

  assert.equal(prepared, runConfig);
  assert.equal(prepared.hookManager, undefined);
});

test("RunConfigExtensionPreparer resolves harness options with workspace basePath and safe defaults", () => {
  const preparer = createPreparer({
    workspaceService: createWorkspaceService("/tmp/noobot-preparer-base"),
  });

  const options = preparer.resolveHarnessPluginOptions({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["harness"],
      plugins: {
        harness: {
          miniRunnerMaxTurns: 99,
          timeoutMs: 1000,
        },
      },
    },
  });

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.basePath, path.join("/tmp/noobot-preparer-base", "u1"));
  assert.equal(options.miniRunnerMaxTurns, 5);
  assert.equal(options.planningGuidanceMode, "separate_model");
  assert.equal(options.timeoutMs, 180_000);
  assert.equal(typeof options.resolveModelMessages, "function");
  assert.equal(typeof options.resolveMessageBlock, "function");
  assert.equal(typeof options.markMessagesSummarized, "function");
  assert.equal(typeof options.capabilityModelInvoker, "function");
});

test("RunConfigExtensionPreparer registers harness once and keeps per-run policy patches on reuse", () => {
  let registerCount = 0;
  const loadedDynamicPlugins = createLoadedPlugins({
    capability: PLUGIN_CAPABILITY.AGENT_REGISTER,
    register(api = {}) {
      registerCount += 1;
      api.policy.appendDenyToolNames(["registered_tool"]);
    },
  });
  const preparer = createPreparer({ loadedDynamicPlugins });

  const first = preparer.prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          denyToolNames: ["first_run_tool"],
        },
      },
    },
  });

  assert.equal(registerCount, 1);
  assert.ok(first.hookManager);
  assert.equal(first.hookManager.__noobotHarnessPluginRegistered, true);
  assert.deepEqual(first.toolPolicy.denyToolNames, ["registered_tool"]);

  const second = preparer.prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      ...first,
      plugins: {
        ...first.plugins,
        harness: {
          ...first.plugins.harness,
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

test("RunConfigExtensionPreparer resolves workflow options and injects runtime helpers", () => {
  const preparer = createPreparer({
    globalConfig: {
      plugins: {
        workflow: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const options = preparer.resolveWorkflowPluginOptions({
    runConfig: {},
    userConfig: {},
  });

  assert.equal(options.enabled, true);
  assert.equal(options.mode, "on");
  assert.equal(options.miniRunnerMaxTurns > 0, true);
  assert.equal(options.maxAutoTransitions > 0, true);
  assert.equal(options.semanticMode, "separate_model");
  assert.equal(typeof options.resolveModelMessages, "function");
  assert.equal(typeof options.capabilityModelInvoker, "function");
  assert.equal(typeof options.subSessionRunner, "function");
  assert.equal(typeof options.generatedArtifactPersister, "function");
  assert.equal(typeof options.workflowDialogPersister, "function");
  assert.equal(typeof options.workflowEventLogger, "function");
});

test("RunConfigExtensionPreparer prepares workflow botHookManager and respects enabled=false override", () => {
  const preparer = createPreparer({
    globalConfig: {
      plugins: {
        workflow: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  const disabled = preparer.resolveWorkflowPluginOptions({
    runConfig: {
      plugins: {
        workflow: {
          enabled: false,
          mode: "off",
        },
      },
    },
  });
  assert.deepEqual(disabled, { enabled: false, mode: "off" });

  const prepared = preparer.prepareWorkflowRunConfig({
    runConfig: {
      plugins: {
        workflow: {
          enabled: true,
          mode: "on",
        },
      },
    },
  });

  assert.ok(prepared.botHookManager);
  assert.equal(prepared.plugins.workflow.enabled, true);
  assert.equal(prepared.plugins.workflow.mode, "on");
});
