/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterHarnessHooks } from "../src/core/hooks.js";

test("createRegisterHarnessHooks wires trace/flush handlers and executes success flow", async () => {
  const calls = [];
  const handlers = new Map();
  const hookManager = {
    on(point, handler, opts) {
      handlers.set(point, { handler, opts });
      calls.push(["on", point, opts]);
      return () => {};
    },
  };

  const registerHarnessHooks = createRegisterHarnessHooks({
    tracePoints: ["before_llm_call"],
    flushPoints: ["after_turn"],
    sessionCleanupPoints: [],
    emitHarnessHookProgress: (_ctx, event, data) => {
      calls.push(["emit", event, data?.point]);
    },
    shouldInjectPromptAtPoint: (point) => {
      calls.push(["shouldInjectPromptAtPoint", point]);
      return true;
    },
    injectPrompt: async (point) => {
      calls.push(["injectPrompt", point]);
    },
    traceHook: async (point) => {
      calls.push(["traceHook", point]);
      return { fsmState: "planning", fsmRejected: false };
    },
    createRunTraceSink: (ctx, options) => {
      calls.push(["createRunTraceSink", !!ctx, !!options]);
      return async () => {};
    },
    flushAllManifests: async () => {
      calls.push(["flushAllManifests"]);
    },
    flushAllJsonlBuffers: async () => {
      calls.push(["flushAllJsonlBuffers"]);
    },
  });

  const options = {
    tracePriority: 20,
    timeoutMs: 1000,
    planningGuidanceMode: "inject",
    capabilityModelInvoker: null,
    capabilityToolAllowlist: [],
    capabilityToolAllowlistByPurpose: {},
    acceptance: {},
    review: {},
  };
  const capabilityRuntime = {
    async runHook(point, ctx, payload) {
      calls.push(["runHook", point, !!ctx, payload?.pluginName]);
      assert.equal(typeof payload?.harness?.runTraceSink, "function");
    },
  };
  const plugin = { name: "noobot-plugin-harness", version: "0.1.0" };

  const disposers = registerHarnessHooks({ hookManager, options, capabilityRuntime, plugin });
  assert.equal(disposers.length, 2);
  assert.equal(handlers.get("before_llm_call")?.opts?.id, `${plugin.name}.trace.before_llm_call`);
  assert.equal(handlers.get("after_turn")?.opts?.id, `${plugin.name}.flush.after_turn`);

  await handlers.get("before_llm_call").handler({ userId: "u1" });
  await handlers.get("after_turn").handler();

  assert.deepEqual(
    calls
      .map((item) => item[0])
      .filter((name) =>
        [
          "runHook",
          "shouldInjectPromptAtPoint",
          "injectPrompt",
          "traceHook",
          "flushAllManifests",
          "flushAllJsonlBuffers",
        ].includes(name),
      ),
    [
      "runHook",
      "shouldInjectPromptAtPoint",
      "injectPrompt",
      "traceHook",
      "flushAllManifests",
      "flushAllJsonlBuffers",
    ],
  );
});

test("createRegisterHarnessHooks emits hook_error and rethrows when trace handler fails", async () => {
  const progressEvents = [];
  const handlers = new Map();
  const hookManager = {
    on(point, handler) {
      handlers.set(point, handler);
      return () => {};
    },
  };

  const registerHarnessHooks = createRegisterHarnessHooks({
    tracePoints: ["before_turn"],
    flushPoints: [],
    sessionCleanupPoints: [],
    emitHarnessHookProgress: (_ctx, event, data) => {
      progressEvents.push({ event, data });
    },
    safeError: () => "safe_error",
  });

  const error = new Error("boom");
  const capabilityRuntime = {
    async runHook() {
      throw error;
    },
  };

  registerHarnessHooks({
    hookManager,
    options: {
      tracePriority: 20,
      timeoutMs: 1000,
      planningGuidanceMode: "inject",
      capabilityModelInvoker: null,
      capabilityToolAllowlist: [],
      capabilityToolAllowlistByPurpose: {},
      acceptance: {},
      review: {},
    },
    capabilityRuntime,
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  await assert.rejects(() => handlers.get("before_turn")({}), /boom/);
  assert.equal(progressEvents.some((item) => item.event === "hook_error"), true);
  assert.equal(progressEvents.at(-1)?.data?.error, "safe_error");
});

test("createRegisterHarnessHooks skips non-primary execution scope", async () => {
  const calls = [];
  const handlers = new Map();
  const hookManager = {
    on(point, handler) {
      handlers.set(point, handler);
      return () => {};
    },
  };

  const registerHarnessHooks = createRegisterHarnessHooks({
    tracePoints: ["before_llm_call"],
    flushPoints: [],
    sessionCleanupPoints: [],
    emitHarnessHookProgress: () => {
      calls.push("emit");
    },
    shouldInjectPromptAtPoint: () => true,
    injectPrompt: async () => {
      calls.push("injectPrompt");
    },
    traceHook: async () => {
      calls.push("traceHook");
      return { fsmState: "planning", fsmRejected: false };
    },
  });

  const capabilityRuntime = {
    async runHook() {
      calls.push("runHook");
    },
  };

  registerHarnessHooks({
    hookManager,
    options: {
      tracePriority: 20,
      timeoutMs: 1000,
      planningGuidanceMode: "inject",
      capabilityModelInvoker: null,
      capabilityToolAllowlist: [],
      capabilityToolAllowlistByPurpose: {},
      acceptance: {},
      review: {},
    },
    capabilityRuntime,
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  await handlers.get("before_llm_call")({ executionScope: "auxiliary" });
  assert.deepEqual(calls, []);
});

test("createRegisterHarnessHooks cleans harness runs on after_session_delete", async () => {
  const calls = [];
  const handlers = new Map();
  const hookManager = {
    on(point, handler) {
      handlers.set(point, handler);
      return () => {};
    },
  };

  const registerHarnessHooks = createRegisterHarnessHooks({
    tracePoints: [],
    flushPoints: [],
    sessionCleanupPoints: ["after_session_delete"],
    flushAllManifests: async () => {
      calls.push("flushAllManifests");
    },
    flushAllJsonlBuffers: async () => {
      calls.push("flushAllJsonlBuffers");
    },
    extractBasePath: () => "/tmp/base",
    cleanupRunsBySessionIds: async (_basePath, sessionIds) => {
      calls.push(["cleanupRunsBySessionIds", sessionIds]);
      return { deleted: 2, matchedRuns: 2, errors: 0 };
    },
    emitHarnessHookProgress: (_ctx, event, data) => {
      calls.push(["emit", event, data?.deleted]);
    },
  });

  registerHarnessHooks({
    hookManager,
    options: { timeoutMs: 1000 },
    capabilityRuntime: {},
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  await handlers.get("after_session_delete")({
    sessionId: "s-parent",
    deletedSessionIds: ["s-parent", "s-child"],
  });

  assert.deepEqual(
    calls.map((item) => (Array.isArray(item) ? item[0] : item)),
    ["flushAllManifests", "flushAllJsonlBuffers", "cleanupRunsBySessionIds", "emit"],
  );
});
