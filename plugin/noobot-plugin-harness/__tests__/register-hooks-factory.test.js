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
    capabilityRuntime: { async runHook() {} },
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
    capabilityRuntime: { async runHook() {} },
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
    capabilityRuntime: { async runHook() {} },
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
    capabilityRuntime: { async runHook() {} },
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

test("createRegisterHarnessHooks keeps message block order and lets incremental current user win", async () => {
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
    shouldInjectPromptAtPoint: () => false,
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
    capabilityRuntime: { async runHook() {} },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const staleCurrentUser = {
    role: "user",
    content: "全仓回归测试",
    additional_kwargs: { turnScopeId: "client-turn:current" },
  };
  const currentUser = {
    role: "user",
    content: "全仓回归测试",
    additional_kwargs: {
      frontendUserMessage: true,
      turnScopeId: "client-turn:current",
    },
  };
  const userMeta = {
    role: "user",
    content: "[用户元信息]\n{}",
    additional_kwargs: { turnScopeId: "client-turn:current" },
  };
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "system context" }],
      history: [
        { role: "assistant", content: "上一轮回答", dialogProcessId: "history-dp" },
        staleCurrentUser,
      ],
      incremental: [
        currentUser,
        userMeta,
        { role: "user", content: "[来自harness外部模型输出/planning]\nplan" },
      ],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  const exactUserIndexes = ctx.messages
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.role === "user" && item?.content === "全仓回归测试")
    .map(({ index }) => index);
  const userMetaIndex = ctx.messages.findIndex((item) =>
    String(item?.content || "").startsWith("[用户元信息]"),
  );

  assert.deepEqual(exactUserIndexes, [userMetaIndex - 1]);
});

test("createRegisterHarnessHooks keeps message block order after prompt injection", async () => {
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
      appendMessage(
        ctx,
        {
          role: "user",
          content: "[来自harness外部模型输出/planning]\n[CURRENT_TASK_GOAL]\n对 `/project` 执行全仓回归测试",
        },
        { block: "incremental" },
      );
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
    capabilityRuntime: { async runHook() {} },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const currentUser = {
    role: "user",
    content: "全仓回归测试",
    additional_kwargs: {
      frontendUserMessage: true,
      turnScopeId: "client-turn:current",
    },
  };
  const userMeta = {
    role: "user",
    content: "[用户元信息]\n{}",
    additional_kwargs: { turnScopeId: "client-turn:current" },
  };
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [
        { role: "system", content: "system context" },
        {
          role: "system",
          content: "<!-- noobot-harness-current-task-goal -->\n[CURRENT_TASK_GOAL]\n对 `/project` 执行全仓回归测试",
        },
      ],
      history: [
        { role: "assistant", content: "上一轮回答", dialogProcessId: "history-dp" },
        {
          role: "user",
          content: "全仓回归测试",
          additional_kwargs: { turnScopeId: "client-turn:current" },
        },
      ],
      incremental: [currentUser, userMeta],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  const exactUserIndexes = ctx.messages
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.role === "user" && item?.content === "全仓回归测试")
    .map(({ index }) => index);
  const userMetaIndex = ctx.messages.findIndex((item) =>
    String(item?.content || "").startsWith("[用户元信息]"),
  );

  assert.deepEqual(exactUserIndexes, [userMetaIndex - 1]);
  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    [
      "system context",
      ["<!-- noobot-harness-current-task-goal -->", "[CURRENT_TASK_GOAL]", "对 `/project` 执行全仓回归测试"].join("\n"),
      "上一轮回答",
      "全仓回归测试",
      "[用户元信息]\n{}",
      ["[来自harness外部模型输出/planning]", "[CURRENT_TASK_GOAL]", "对 `/project` 执行全仓回归测试"].join("\n"),
    ],
  );
});

test("createRegisterHarnessHooks preserves unsummarized history messages between user and assistant", async () => {
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
      appendMessage(ctx, { role: "user", content: "current harness prompt" }, { block: "incremental" });
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
    capabilityRuntime: { async runHook() {} },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const ctx = {
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "system context" }],
      history: [
        {
          role: "user",
          content: "下一步",
          summarized: false,
          dialogProcessId: "history-dp",
        },
        {
          role: "user",
          content: "[来自harness外部模型输出/planning]\nplan",
          summarized: false,
          dialogProcessId: "history-dp",
        },
        {
          role: "user",
          content: "[来自harness外部模型输出/planning_followup]\nfollowup",
          summarized: false,
          dialogProcessId: "history-dp",
        },
        {
          role: "assistant",
          content: "assistant answer",
          summarized: false,
          dialogProcessId: "history-dp",
        },
      ],
      incremental: [
        {
          role: "user",
          content: "current user",
          additional_kwargs: { frontendUserMessage: true },
        },
      ],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    [
      "system context",
      "下一步",
      "[来自harness外部模型输出/planning]\nplan",
      "[来自harness外部模型输出/planning_followup]\nfollowup",
      "assistant answer",
      "current user",
      "current harness prompt",
    ],
  );
});

test("createRegisterHarnessHooks can recover current-turn harness injections after summary filtering", async () => {
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
    shouldInjectPromptAtPoint: () => false,
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
    capabilityRuntime: { async runHook() {} },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const system = { role: "system", content: "system context" };
  const harnessInjection = {
    role: "user",
    content: "harness current-turn injection",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    dialogProcessId: "dlg-current",
  };
  const noisyMessages = [
    { role: "assistant", content: "tool burst 1" },
    { role: "assistant", content: "tool burst 2" },
    { role: "assistant", content: "tool burst 3" },
  ];
  const ctx = {
    messages: [system, harnessInjection, ...noisyMessages],
    messageBlocks: {
      system: [system],
      history: [],
      incremental: [harnessInjection, ...noisyMessages],
    },
    dialogProcessId: "dlg-current",
  };

  await handlers.get("before_llm_call")(ctx);
  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["system context", "harness current-turn injection", "tool burst 1", "tool burst 2", "tool burst 3"],
  );
  assert.deepEqual(
    ctx.messageBlocks.incremental.map((item) => item.content),
    [
      "harness current-turn injection",
      "tool burst 1",
      "tool burst 2",
      "tool burst 3",
    ],
  );

  for (const message of noisyMessages) {
    message.summarized = true;
  }

  await handlers.get("before_llm_call")(ctx);
  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["system context", "harness current-turn injection"],
  );
});

test("createRegisterHarnessHooks keeps multiple empty assistant tool-call messages with different call ids", async () => {
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
    shouldInjectPromptAtPoint: () => false,
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
    capabilityRuntime: { async runHook() {} },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const assistant1 = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_a", type: "function", function: { name: "execute_script" } }],
  };
  const tool1 = { role: "tool", content: "{\"ok\":false}", tool_call_id: "call_a" };
  const assistant2 = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_b", type: "function", function: { name: "execute_script" } }],
  };
  const tool2 = { role: "tool", content: "{\"ok\":false}", tool_call_id: "call_b" };

  const ctx = {
    messages: [{ role: "system", content: "system" }, assistant1, tool1, assistant2, tool2],
    messageBlocks: {
      system: [{ role: "system", content: "system" }],
      history: [],
      incremental: [assistant1, tool1, assistant2, tool2],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  const assistantIds = ctx.messages
    .filter((item) => item.role === "assistant")
    .map((item) => item.tool_calls?.[0]?.id);
  assert.deepEqual(assistantIds, ["call_a", "call_b"]);
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
