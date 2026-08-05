/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterHarnessHooks } from "../../src/core/hooks.js";
import { appendMessage } from "../../src/core/message-store.js";
import { resolveModelFinalMessages as resolveMainModelFinalMessages } from "@noobot/context-protocol";

function resolveFromBlocks({ ctx = {} } = {}) {
  const blocks = ctx?.modelContext?.messageBlocks && typeof ctx.modelContext.messageBlocks === "object" ? ctx.modelContext.messageBlocks : {};
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
    tracePoints: ["agent.before_llm_call"],
    flushPoints: ["agent.after_turn"],
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
    planning: { planUpdate: { triggerTurnsThreshold: 1 } },
    acceptance: { phase: { triggerTurnsThreshold: 1 } },
    review: {},
  };
  const capabilityRuntime = {
    async runHook(point, ctx, payload) {
      calls.push(["runHook", point, !!ctx, payload?.pluginName]);
      assert.equal("runTraceSink" in payload.harness, false);
      assert.deepEqual(payload.harness.planning, options.planning);
      assert.deepEqual(payload.harness.acceptance, options.acceptance);
      await payload?.harness?.globalBootstrap?.();
    },
  };
  const plugin = { name: "noobot-plugin-harness", version: "0.1.0" };

  const disposers = registerHarnessHooks({ hookManager, options, capabilityRuntime, plugin });
  assert.equal(disposers.length, 2);
  assert.equal(handlers.get("agent.before_llm_call")?.opts?.id, `${plugin.name}.trace.agent.before_llm_call`);
  assert.equal(handlers.get("agent.after_turn")?.opts?.id, `${plugin.name}.flush.agent.after_turn`);

  const traceResult = await handlers.get("agent.before_llm_call").handler({ userId: "u1" });
  assert.deepEqual(traceResult, { fsmState: "planning", fsmRejected: false });
  await handlers.get("agent.after_turn").handler();

  assert.deepEqual(
    calls
      .map((item) => item[0])
      .filter((name) =>
        [
          "runHook",
          "injectPrompt",
          "traceHook",
          "flushAllManifests",
          "flushAllJsonlBuffers",
        ].includes(name),
      ),
    [
      "runHook",
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
    tracePoints: ["agent.before_turn"],
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

  await assert.rejects(() => handlers.get("agent.before_turn")({}), /boom/);
  assert.equal(progressEvents.some((item) => item.event === "hook_error"), true);
  assert.equal(progressEvents.at(-1)?.data?.error, "safe_error");
});
