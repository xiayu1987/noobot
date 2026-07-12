import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterHarnessHooks } from "../src/core/hooks.js";
import { injectMessageWithPolicy } from "../src/capabilities/handlers/shared/message/injection-utils.js";
import { resolveMainModelFinalMessages } from "../../../agent/src/system-core/session/utils/context-window-normalizer.js";

function resolveFromBlocks({ ctx = {} } = {}) {
  const blocks = ctx?.messageBlocks && typeof ctx.messageBlocks === "object" ? ctx.messageBlocks : {};
  return resolveMainModelFinalMessages({
    systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
    historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
    incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  }).messages;
}

test("dynamic harness main-flow system injections stay in system block", () => {
  const ctx = { messages: [] };
  const result = injectMessageWithPolicy(ctx, {
    role: "system",
    content: "dynamic planning context",
    injectedMessageType: "planning_context_summary",
    injectAt: "append",
  });

  assert.equal(result.injected, true);
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.messages[0]?.role, "system");
  assert.equal(ctx.messages[0]?.injectedMessage, true);
  assert.equal(ctx.messages[0]?.injectedBy, "harness-plugin");
  assert.ok(ctx.messages[0]?.additional_kwargs?.noobotMessageId);
  assert.equal(ctx.messageBlocks.system[0], ctx.messages[0]);
  assert.deepEqual(ctx.messageBlocks.incremental, []);
  assert.equal(ctx.messageBlocks.systemIds, undefined);
  assert.equal(ctx.messageBlocks.incrementalIds, undefined);
});

test("dynamic harness system injections compose before history", async () => {
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
      injectMessageWithPolicy(ctx, {
        role: "system",
        content: "dynamic planning context",
        injectedMessageType: "planning_context_summary",
        injectAt: "append",
      });
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
    capabilityRuntime: {
      async runHook(_point, _ctx, payload = {}) {
        await payload?.harness?.globalBootstrap?.();
      },
    },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const system = { role: "system", content: "stable system" };
  const history = { role: "assistant", content: "stable history", dialogProcessId: "history-dp" };
  const currentUser = {
    role: "user",
    content: "current user",
    additional_kwargs: { frontendUserMessage: true },
  };
  const ctx = {
    messages: [system, history, currentUser],
    messageBlocks: {
      system: [system],
      history: [history],
      incremental: [currentUser],
    },
  };

  await handlers.get("before_llm_call")(ctx);

  assert.deepEqual(
    ctx.messages.map((item) => `${item.role}:${item.content}`),
    [
      "system:stable system",
      "system:dynamic planning context",
      "assistant:stable history",
      "user:current user",
    ],
  );
  assert.equal(ctx.messageBlocks.system.at(-1)?.content, "dynamic planning context");
});

test("main model incremental context keeps unsummarized same-type harness relays append-only", () => {
  const relayOne = {
    role: "user",
    content: "[来自harness外部模型输出/guidance]\nfirst guidance",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
  };
  const assistant = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-1", name: "read_file", args: {}, type: "tool_call" }],
  };
  const tool = {
    role: "tool",
    content: "{\"toolName\":\"read_file\",\"ok\":true}",
    tool_call_id: "call-1",
  };
  const relayTwo = {
    role: "user",
    content: "[来自harness外部模型输出/guidance]\nsecond guidance",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "separate_model_relay:guidance",
  };

  const beforeSummary = resolveMainModelFinalMessages({
    incrementalMessages: [relayOne, assistant, tool, relayTwo],
  }).messages;

  assert.deepEqual(
    beforeSummary.map((item) => item.content),
    [
      "[来自harness外部模型输出/guidance]\nfirst guidance",
      "",
      "{\"toolName\":\"read_file\",\"ok\":true}",
      "[来自harness外部模型输出/guidance]\nsecond guidance",
    ],
  );

  relayOne.summarized = true;
  const afterSummary = resolveMainModelFinalMessages({
    incrementalMessages: [relayOne, assistant, tool, relayTwo],
  }).messages;

  assert.deepEqual(
    afterSummary.map((item) => item.content),
    [
      "",
      "{\"toolName\":\"read_file\",\"ok\":true}",
      "[来自harness外部模型输出/guidance]\nsecond guidance",
    ],
  );
});
