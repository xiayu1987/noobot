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
    capabilityRuntime: capabilityRuntimeWithBootstrap,
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
    capabilityRuntime: capabilityRuntimeWithBootstrap,
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
    capabilityRuntime: capabilityRuntimeWithBootstrap,
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
    capabilityRuntime: capabilityRuntimeWithBootstrap,
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
    capabilityRuntime: capabilityRuntimeWithBootstrap,
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
