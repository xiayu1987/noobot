/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterHarnessHooks } from "../src/core/hooks.js";
import { appendMessage } from "../src/core/message-store.js";
import { resolveMainModelFinalMessages } from "../../../agent/src/system-core/session/utils/context-window-normalizer.js";

function resolveFromBlocks({ ctx = {} } = {}) {
  const blocks = ctx?.messageBlocks && typeof ctx.messageBlocks === "object" ? ctx.messageBlocks : {};
  return resolveMainModelFinalMessages({
    systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
    historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
    incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  }).messages;
}

const capabilityRuntimeWithBootstrap = {
  async runHook(_point, _ctx, payload = {}) {
    await payload?.harness?.globalBootstrap?.();
  },
};


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
