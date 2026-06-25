import test from "node:test";
import assert from "node:assert/strict";

import { createRegisterHarnessHooks } from "../src/core/hooks.js";
import { injectMessageWithPolicy } from "../src/capabilities/handlers/shared/message/injection-utils.js";

test("dynamic harness main-flow injections resolve to user/incremental", () => {
  const ctx = { messages: [] };
  const result = injectMessageWithPolicy(ctx, {
    role: "system",
    content: "dynamic planning context",
    injectedMessageType: "planning_context_summary",
    injectAt: "append",
  });

  assert.equal(result.injected, true);
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.messages[0]?.role, "user");
  assert.equal(ctx.messages[0]?.injectedMessage, true);
  assert.equal(ctx.messages[0]?.injectedBy, "harness-plugin");
  assert.ok(ctx.messages[0]?.additional_kwargs?.noobotMessageId);
  assert.deepEqual(ctx.messageBlocks.incrementalIds, [
    ctx.messages[0].additional_kwargs.noobotMessageId,
  ]);
});

test("dynamic harness injections compact after history to preserve stable prefix cache", async () => {
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
      resolveMessageBlock: ({ messages = [] }) => messages,
    },
    capabilityRuntime: { async runHook() {} },
    plugin: { name: "noobot-plugin-harness", version: "0.1.0" },
  });

  const system = { role: "system", content: "stable system" };
  const history = { role: "assistant", content: "stable history" };
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
      "assistant:stable history",
      "user:current user",
      "user:dynamic planning context",
    ],
  );
  assert.equal(ctx.messageBlocks.incremental.at(-1)?.content, "dynamic planning context");
});
