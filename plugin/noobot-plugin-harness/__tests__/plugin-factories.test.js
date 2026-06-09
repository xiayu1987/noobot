/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createPluginRuntimeContextFactory,
  assertHookManager,
} from "../src/core/context.js";
import { formatHarnessCoreError, HARNESS_CORE_ERROR } from "../src/core/error-messages.js";
import { createRegisterNoobotPlugin } from "../src/core/plugin.js";
import { createHarnessPluginFactory } from "../src/core/plugin.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "../src/core/constants.js";

test("createPluginRuntimeContextFactory wires injected deps and normalizes planning guidance", () => {
  const calls = [];
  const hookManager = { on() {} };
  const capabilityRuntime = { hookMap: { before_turn: ["planning"] } };
  const normalizeOptions = (userOptions, api) => {
    calls.push(["normalizeOptions", userOptions, api]);
    return {
      planningGuidanceMode: "separate_model",
      capabilityModelInvoker: null,
      capabilityProfile: "engineering",
      capabilityHandlers: { planning: async () => null },
    };
  };
  const resolveHookManager = (api) => {
    calls.push(["resolveHookManager", api]);
    return hookManager;
  };
  const createCapabilityRuntime = (input) => {
    calls.push(["createCapabilityRuntime", input]);
    return capabilityRuntime;
  };

  const createPluginRuntimeContext = createPluginRuntimeContextFactory({
    normalizeOptions,
    resolveHookManager,
    createCapabilityRuntime,
  });

  const api = {
    hookManager,
    policy: {
      appendDenyToolNames: (toolNames = []) => {
        calls.push(["appendDenyToolNames", toolNames]);
      },
    },
  };
  const userOptions = { enabled: true };
  const result = createPluginRuntimeContext(api, userOptions);

  assert.equal(result.options.planningGuidanceMode, "inject");
  assert.equal(result.hookManager, hookManager);
  assert.equal(result.capabilityRuntime, capabilityRuntime);
  assert.equal(result.options.capabilityRuntime, capabilityRuntime);
  assert.deepEqual(calls.map((item) => item[0]), [
    "normalizeOptions",
    "resolveHookManager",
    "createCapabilityRuntime",
  ]);
});

test("assertHookManager throws on invalid manager", () => {
  assert.throws(() => assertHookManager(null), /hookManager with \.on\(point, handler, options\) is required/);
  assert.doesNotThrow(() => assertHookManager({ on() {} }));
});

test("assertHookManager supports zh-CN localized error", () => {
  assert.throws(
    () => assertHookManager(null, { locale: "zh-CN" }),
    /需要提供支持 \.on\(point, handler, options\) 的 hookManager/,
  );
});

test("formatHarnessCoreError supports localized cleanup warning", () => {
  const zhText = formatHarnessCoreError(HARNESS_CORE_ERROR.CLEANUP_OLD_RUNS_FAILED, {
    locale: "zh-CN",
    params: { message: "boom" },
  });
  const enText = formatHarnessCoreError(HARNESS_CORE_ERROR.CLEANUP_OLD_RUNS_FAILED, {
    locale: "en-US",
    params: { message: "boom" },
  });
  assert.match(zhText, /清理历史运行目录失败/);
  assert.match(enText, /cleanupOldRuns failed during plugin registration/);
});

test("createRegisterNoobotPlugin returns early when disabled", () => {
  let registerHarnessHooksCalled = false;
  const registerNoobotPlugin = createRegisterNoobotPlugin({
    createPluginRuntimeContext: () => ({
      options: { enabled: false },
      hookManager: { on() {} },
      capabilityRuntime: {},
    }),
    registerHarnessHooks: () => {
      registerHarnessHooksCalled = true;
      return [];
    },
  });

  const result = registerNoobotPlugin({}, {});
  assert.deepEqual(result, { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] });
  assert.equal(registerHarnessHooksCalled, false);
});

test("createRegisterNoobotPlugin uses injected collaborators on happy path", async () => {
  const calls = [];
  const hookManager = { on() {} };
  const capabilityRuntime = { hookMap: {} };
  const options = { enabled: true, tracePriority: 20 };

  const registerNoobotPlugin = createRegisterNoobotPlugin({
    createPluginRuntimeContext: (api, userOptions) => {
      calls.push(["createPluginRuntimeContext", api, userOptions]);
      return { options, hookManager, capabilityRuntime };
    },
    assertHookManager: (hm) => {
      calls.push(["assertHookManager", hm]);
    },
    extractBasePath: (ctx, inputOptions) => {
      calls.push(["extractBasePath", ctx, inputOptions]);
      return "/tmp/noobot";
    },
    cleanupOldRuns: async (basePath, inputOptions) => {
      calls.push(["cleanupOldRuns", basePath, inputOptions]);
      throw new Error("cleanup failed");
    },
    registerHarnessHooks: (input) => {
      calls.push(["registerHarnessHooks", input]);
      return [() => {}];
    },
  });

  const api = { hookManager };
  const userOptions = { enabled: true };
  const result = registerNoobotPlugin(api, userOptions);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.name, PLUGIN_NAME);
  assert.equal(result.version, PLUGIN_VERSION);
  assert.equal(Array.isArray(result.disposers), true);
  assert.equal(result.disposers.length, 1);
  assert.deepEqual(calls.map((item) => item[0]), [
    "createPluginRuntimeContext",
    "assertHookManager",
    "extractBasePath",
    "cleanupOldRuns",
    "registerHarnessHooks",
  ]);
});

test("createRegisterNoobotPlugin appends denyToolNames via unified policy api", () => {
  const calls = [];
  const registerNoobotPlugin = createRegisterNoobotPlugin({
    createPluginRuntimeContext: () => ({
      options: { enabled: true, denyToolNames: ["plan_multi_task_collaboration"] },
      hookManager: { on() {} },
      capabilityRuntime: {},
    }),
    assertHookManager: () => {},
    extractBasePath: () => "",
    cleanupOldRuns: async () => {},
    registerHarnessHooks: () => [],
  });

  const result = registerNoobotPlugin({
    policy: {
      appendDenyToolNames: (toolNames = []) => calls.push([...(toolNames || [])]),
    },
  });

  assert.equal(result.name, PLUGIN_NAME);
  assert.deepEqual(calls, [["plan_multi_task_collaboration"]]);
});

test("createHarnessPluginFactory binds normalized options into register", () => {
  const calls = [];
  const normalized = { enabled: true, trace: false };
  const expectedRegistration = { name: "x", version: "y", disposers: [] };

  const createHarnessPlugin = createHarnessPluginFactory({
    normalizeOptions: (userOptions) => {
      calls.push(["normalizeOptions", userOptions]);
      return normalized;
    },
    registerNoobotPlugin: (api, userOptions) => {
      calls.push(["registerNoobotPlugin", api, userOptions]);
      return expectedRegistration;
    },
  });

  const plugin = createHarnessPlugin({ trace: false });
  assert.equal(plugin.name, PLUGIN_NAME);
  assert.equal(plugin.version, PLUGIN_VERSION);
  assert.equal(plugin.options, normalized);

  const registration = plugin.register({ hookManager: { on() {} } });
  assert.equal(registration, expectedRegistration);
  assert.deepEqual(calls.map((item) => item[0]), ["normalizeOptions", "registerNoobotPlugin"]);
  assert.equal(calls[1][2], normalized);
});
