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


test("createRegisterHarnessHooks leaves plain messages un-compacted without message blocks", async () => {
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
    emitHarnessHookProgress: () => {},
    shouldInjectPromptAtPoint: () => true,
    injectPrompt: async (_point, ctx) => {
      ctx.messages.push({ role: "user", content: "harness prompt" });
    },
    traceHook: async () => ({ fsmState: "planning", fsmRejected: false }),
  });

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
    capabilityRuntime: capabilityRuntimeWithBootstrap,
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const ctx = {
    messages: [
      { role: "system", content: "system context" },
      { role: "user", content: "h1" },
      { role: "user", content: "h2" },
      { role: "user", content: "h3" },
    ],
  };
  await handlers.get("before_llm_call")(ctx);
  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["system context", "h1", "h2", "h3", "harness prompt"],
  );
});

test("createRegisterHarnessHooks composes by system history incremental message blocks", async () => {
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
    emitHarnessHookProgress: () => {},
    shouldInjectPromptAtPoint: () => true,
    injectPrompt: async (_point, ctx) => {
      appendMessage(ctx, { role: "user", content: "injected incremental" }, { block: "incremental" });
    },
    traceHook: async () => ({ fsmState: "planning", fsmRejected: false }),
  });

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
      resolveModelMessages: resolveFromBlocks,
    },
    capabilityRuntime: capabilityRuntimeWithBootstrap,
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const frontendUser = {
    role: "user",
    content: "real user message",
    additional_kwargs: { frontendUserMessage: true },
  };
  const ctx = {
    messages: [
      { role: "system", content: "system context" },
      { role: "user", content: "history-1" },
      { role: "assistant", content: "history-2" },
      frontendUser,
    ],
    messageBlocks: {
      system: [{ role: "system", content: "system context" }],
      history: [
        { role: "user", content: "history-1", dialogProcessId: "history-dp" },
        { role: "assistant", content: "history-2", dialogProcessId: "history-dp" },
      ],
      incremental: [frontendUser],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["system context", "history-1", "history-2", "real user message", "injected incremental"],
  );
});

test("createRegisterHarnessHooks keeps compacted messageBlocks as single-store views", async () => {
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
    emitHarnessHookProgress: () => {},
    shouldInjectPromptAtPoint: () => true,
    injectPrompt: async (_point, ctx) => {
      ctx.messages.push({ role: "user", content: "injected" });
    },
    traceHook: async () => ({ fsmState: "planning", fsmRejected: false }),
  });

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
      resolveModelMessages: resolveFromBlocks,
    },
    capabilityRuntime: capabilityRuntimeWithBootstrap,
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const ctx = {
    messages: [
      { role: "system", content: "system" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "write_file" } }] },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "call_1" },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "system" }],
      history: [],
      incremental: [
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "write_file" } }] },
        { role: "tool", content: "{\"ok\":true}", tool_call_id: "call_1" },
      ],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  const toolCallMessage = ctx.messages.find((message) => Array.isArray(message?.tool_calls));
  assert.ok(toolCallMessage);
  assert.equal(ctx.messageBlocks.incremental[0], toolCallMessage);
  assert.ok(toolCallMessage.additional_kwargs.noobotMessageId);
  assert.equal(ctx.messageBlocks.incrementalIds, undefined);
  toolCallMessage.summarized = true;
  assert.equal(ctx.messageBlocks.incremental[0].summarized, true);
});

test("createRegisterHarnessHooks ignores messages outside agent-provided message blocks", async () => {
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
    emitHarnessHookProgress: () => {},
    shouldInjectPromptAtPoint: () => true,
    injectPrompt: async (_point, ctx) => {
      ctx.messages.push({ role: "system", content: "legacy system extra" });
      ctx.messages.push({ role: "user", content: "legacy incremental extra" });
      appendMessage(ctx, { role: "user", content: "block incremental" }, { block: "incremental" });
    },
    traceHook: async () => ({ fsmState: "planning", fsmRejected: false }),
  });

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
      resolveModelMessages: resolveFromBlocks,
    },
    capabilityRuntime: capabilityRuntimeWithBootstrap,
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const ctx = {
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "history" },
      { role: "user", content: "current" },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "system" }],
      history: [{ role: "user", content: "history", dialogProcessId: "history-dp" }],
      incremental: [{ role: "user", content: "current" }],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["system", "history", "current", "block incremental"],
  );
});
