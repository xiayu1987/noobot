/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createPluginRuntimeContextFactory, assertHookManager } from "../../src/core/context.js";
import { formatHarnessCoreError, HARNESS_CORE_ERROR } from "../../src/core/error-messages.js";
import { createHarnessCoreFactory, createHarnessRegistration } from "../../src/core/plugin.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "../../src/core/constants.js";

test("createPluginRuntimeContextFactory wires injected deps and keeps normalized planning guidance mode", () => {
  const calls = [];
  const hookManager = { on() {} };
  const capabilityRuntime = { hookMap: { before_turn: ["planning"] } };
  const normalizeOptions = (userOptions, api) => {
    calls.push(["normalizeOptions", userOptions, api]);
    return {
      planningGuidanceMode: "inject",
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
      patch: (policy = {}) => {
        calls.push(["policy.patch", policy]);
      },
    },
  };
  const userOptions = { enabled: true };
  const result = createPluginRuntimeContext(api, userOptions);

  assert.equal(result.options.planningGuidanceMode, "inject");
  assert.equal(result.hookManager, hookManager);
  assert.equal(result.capabilityRuntime, capabilityRuntime);
  assert.equal(result.options.capabilityRuntime, capabilityRuntime);
  assert.deepEqual(
    calls.map((item) => item[0]),
    ["normalizeOptions", "resolveHookManager", "createCapabilityRuntime"],
  );
});

test("assertHookManager throws on invalid manager", () => {
  assert.throws(
    () => assertHookManager(null),
    /hookManager with \.on\(point, handler, options\) is required/,
  );
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

test("createHarnessRegistration returns early when disabled", () => {
  let registerHarnessHooksCalled = false;
  const registerHarnessCore = createHarnessRegistration({
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

  const result = registerHarnessCore({}, {});
  assert.deepEqual(result, { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] });
  assert.equal(registerHarnessHooksCalled, false);
});

test("createHarnessRegistration uses injected collaborators on happy path", () => {
  const calls = [];
  const hookManager = { on() {} };
  const capabilityRuntime = { hookMap: {} };
  const options = { enabled: true, tracePriority: 20 };

  const registerHarnessCore = createHarnessRegistration({
    createPluginRuntimeContext: (api, userOptions) => {
      calls.push(["createPluginRuntimeContext", api, userOptions]);
      return { options, hookManager, capabilityRuntime };
    },
    assertHookManager: (hm) => {
      calls.push(["assertHookManager", hm]);
    },
    registerHarnessHooks: (input) => {
      calls.push(["registerHarnessHooks", input]);
      return [() => {}];
    },
  });

  const result = registerHarnessCore({ hookManager }, { enabled: true });

  assert.equal(result.name, PLUGIN_NAME);
  assert.equal(result.version, PLUGIN_VERSION);
  assert.equal(result.disposers.length, 1);
  assert.deepEqual(
    calls.map((item) => item[0]),
    ["createPluginRuntimeContext", "assertHookManager", "registerHarnessHooks"],
  );
});

test("createHarnessRegistration patches denyToolNames via unified policy api", () => {
  const calls = [];
  const registerHarnessCore = createHarnessRegistration({
    createPluginRuntimeContext: () => ({
      options: { enabled: true, denyToolNames: ["task_summary"] },
      hookManager: { on() {} },
      capabilityRuntime: {},
    }),
    assertHookManager: () => {},
    registerHarnessHooks: () => [],
  });

  const result = registerHarnessCore({
    policy: {
      patch: (policyPatch = {}) => calls.push(policyPatch),
    },
  });

  assert.equal(result.name, PLUGIN_NAME);
  assert.deepEqual(calls, [{ denyToolNames: ["task_summary"] }]);
});

test("createHarnessCoreFactory binds normalized options into register", () => {
  const calls = [];
  const normalized = { enabled: true, trace: false };
  const expectedRegistration = { name: "x", version: "y", disposers: [] };

  const createHarnessCore = createHarnessCoreFactory({
    normalizeOptions: (userOptions) => {
      calls.push(["normalizeOptions", userOptions]);
      return normalized;
    },
    registerHarnessCore: (api, userOptions) => {
      calls.push(["registerHarnessCore", api, userOptions]);
      return expectedRegistration;
    },
  });

  const plugin = createHarnessCore({ trace: false });
  assert.equal(plugin.name, PLUGIN_NAME);
  assert.equal(plugin.version, PLUGIN_VERSION);
  assert.equal(plugin.options, normalized);

  const registration = plugin.register({ hookManager: { on() {} } });
  assert.equal(registration, expectedRegistration);
  assert.deepEqual(
    calls.map((item) => item[0]),
    ["normalizeOptions", "registerHarnessCore"],
  );
  assert.equal(calls[1][2], normalized);
});
