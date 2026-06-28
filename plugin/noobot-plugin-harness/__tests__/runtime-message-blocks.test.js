import test from "node:test";
import assert from "node:assert/strict";

import { createCapabilityRuntime } from "../src/capabilities/runtime.js";
import { resolveMainModelFinalMessages } from "../../../agent/src/system-core/session/utils/context-window-normalizer.js";

function resolveFromBlocks({ ctx = {} } = {}) {
  const blocks = ctx?.messageBlocks && typeof ctx.messageBlocks === "object" ? ctx.messageBlocks : {};
  return resolveMainModelFinalMessages({
    systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
    historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
    incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
  }).messages;
}

test("capability runtime runs global bootstrap before capability handlers", async () => {
  const calls = [];
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: true },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
    handlers: {
      planning: async () => {
        calls.push("planning");
        return { capability: "planning", point: "before_llm_call", status: "ok" };
      },
    },
  });

  await runtime.runHook("before_llm_call", {}, {
    harness: {
      globalBootstrap: async () => {
        calls.push("globalBootstrap");
      },
    },
  });

  assert.deepEqual(calls, ["globalBootstrap", "planning"]);
});

test("capability runtime exposes resolved capability profile to handlers", async () => {
  let capturedProfile = null;
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: true },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
    handlers: {
      guidance: async ({ meta = {} } = {}) => {
        capturedProfile = meta?.harness?.capabilityProfile || null;
        return { capability: "guidance", point: "before_llm_call", status: "ok" };
      },
    },
  });

  await runtime.runHook("before_llm_call", { messages: [] }, {});

  assert.equal(capturedProfile?.planning?.enabled, false);
  assert.equal(capturedProfile?.guidance?.enabled, true);
  assert.equal(capturedProfile?.acceptance?.enabled, false);
});

test("capability runtime keeps planning first without blocking later before_llm_call flows", async () => {
  const calls = [];
  const runtime = createCapabilityRuntime({
    handlers: {
      planning: async () => {
        calls.push("planning");
        return { capability: "planning", point: "before_llm_call", status: "active" };
      },
      guidance: async () => {
        calls.push("guidance");
        return { capability: "guidance", point: "before_llm_call", status: "active" };
      },
      acceptance: async () => {
        calls.push("acceptance");
        return { capability: "acceptance", point: "before_llm_call", status: "active" };
      },
    },
    profile: {
      review: { enabled: false },
    },
  });
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          state: {
            flags: { planningCaptured: false },
          },
        },
      },
    },
    messages: [],
  };

  const results = await runtime.runHook("before_llm_call", ctx, {});

  assert.deepEqual(calls, ["planning", "guidance", "acceptance"]);
  assert.deepEqual(results.map((item = {}) => item.capability), ["planning", "guidance", "acceptance"]);
});

test("capability runtime does not block guidance when plan text exists but captured flag is stale", async () => {
  const calls = [];
  const runtime = createCapabilityRuntime({
    handlers: {
      planning: async () => {
        calls.push("planning");
        return { capability: "planning", point: "before_llm_call", status: "active" };
      },
      guidance: async () => {
        calls.push("guidance");
        return { capability: "guidance", point: "before_llm_call", status: "active" };
      },
      acceptance: async () => {
        calls.push("acceptance");
        return { capability: "acceptance", point: "before_llm_call", status: "active" };
      },
    },
    profile: {
      review: { enabled: false },
    },
  });
  const ctx = {
    agentContext: {
      payload: {
        harness: {
          planText: "1. 已有主计划",
          state: {
            flags: { planningCaptured: false },
          },
        },
      },
    },
    messages: [],
  };

  await runtime.runHook("before_llm_call", ctx, {});

  assert.deepEqual(calls, ["planning", "guidance", "acceptance"]);
  assert.equal(ctx.agentContext.payload.harness.state.flags.planningCaptured, true);
});

test("capability runtime delegates before_llm_call messages to agent resolver", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
  });
  const ctx = {
    messages: [{ role: "assistant", content: "legacy" }],
    messageBlocks: {
      system: [{ role: "system", content: "sys1" }],
      history: [{ role: "assistant", content: "h1", dialogProcessId: "d1" }],
      incremental: [{ role: "user", content: "u1" }],
    },
  };
  const calls = [];
  await runtime.runHook("before_llm_call", ctx, {
    harness: {
      resolveModelMessages: ({ ctx: resolverCtx = {} } = {}) => {
        calls.push("resolveModelMessages");
        return [
          ...resolverCtx.messageBlocks.system,
          ...resolverCtx.messageBlocks.history,
          { role: "assistant", content: "h2" },
          ...resolverCtx.messageBlocks.incremental.filter((item) => item?.role === "user"),
        ];
      },
    },
  });

  assert.deepEqual(calls, ["resolveModelMessages"]);
  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["sys1", "h1", "h2", "u1"],
  );
});

test("capability runtime filters summarized messages from incremental blocks by default", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
  });
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [
        { role: "assistant", content: "summarized-history", summarized: true, dialogProcessId: "d1" },
        { role: "assistant", content: "active-history", dialogProcessId: "d1" },
      ],
      incremental: [
        { role: "assistant", content: "summarized-incremental", summarized: true },
        { role: "tool", content: "summarized-tool", lc_kwargs: { summarized: true } },
        { role: "user", content: "current user", additional_kwargs: { frontendUserMessage: true } },
      ],
    },
  };

  await runtime.runHook("before_llm_call", ctx, { harness: { resolveModelMessages: resolveFromBlocks } });

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["sys", "active-history", "current user"],
  );
  assert.deepEqual(
    ctx.messageBlocks.incremental.map((item) => item.content),
    ["summarized-incremental", "summarized-tool", "current user"],
  );
});

test("capability runtime does not let resolver reintroduce summarized messages", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
  });
  const summarized = { role: "assistant", content: "summarized-incremental", summarized: true };
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        summarized,
        { role: "user", content: "current user", additional_kwargs: { frontendUserMessage: true } },
      ],
    },
  };

  await runtime.runHook("before_llm_call", ctx, {
    harness: { resolveModelMessages: resolveFromBlocks },
  });

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["current user"],
  );
  assert.deepEqual(
    ctx.messageBlocks.incremental.map((item) => item.content),
    ["summarized-incremental", "current user"],
  );
});

test("capability runtime applies message blocks only once per runtime turn context", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
  });
  const ctx = {
    messages: [{ role: "assistant", content: "legacy" }],
    messageBlocks: {
      system: [{ role: "system", content: "sys1" }],
      history: [{ role: "assistant", content: "h1", dialogProcessId: "d1" }],
      incremental: [{ role: "user", content: "u1" }],
    },
    agentContext: {
      execution: {
        controllers: {
          runtime: {},
        },
      },
    },
  };
  const originalMessageBlocks = ctx.messageBlocks;

  await runtime.runHook("before_llm_call", ctx, {
    harness: { resolveModelMessages: resolveFromBlocks },
  });
  assert.equal(ctx.messageBlocks, originalMessageBlocks);
  ctx.messages.push({ role: "assistant", content: "after-first-call" });
  await runtime.runHook("before_llm_call", ctx, {
    harness: { resolveModelMessages: resolveFromBlocks },
  });

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["sys1", "h1", "u1"],
  );
});

test("capability runtime preserves history and incremental user messages in block order", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
  });
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [
        { role: "system", content: "sys" },
        {
          role: "system",
          content: "<!-- noobot-harness-current-task-goal -->\n[CURRENT_TASK_GOAL]\n对 `/project` 执行全仓回归测试",
        },
      ],
      history: [
        { role: "assistant", content: "上一轮回答", dialogProcessId: "d-old" },
        {
          role: "user",
          content: "全仓回归测试",
          dialogProcessId: "d-current",
          additional_kwargs: { turnScopeId: "client-turn:current" },
        },
      ],
      incremental: [
        {
          role: "user",
          content: "全仓回归测试",
          dialogProcessId: "d-current",
          additional_kwargs: { turnScopeId: "client-turn:current", frontendUserMessage: true },
        },
        {
          role: "user",
          content: "[用户元信息]\n{}",
          additional_kwargs: { turnScopeId: "client-turn:current" },
        },
        { role: "user", content: "[来自harness外部模型输出/planning]\n[CURRENT_TASK_GOAL]\n对 `/project` 执行全仓回归测试" },
      ],
    },
    agentContext: {
      execution: {
        controllers: {
          runtime: {},
        },
      },
    },
  };

  await runtime.runHook("before_llm_call", ctx, {
    harness: { resolveModelMessages: resolveFromBlocks },
  });

  const userTextIndexes = ctx.messages
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.role === "user" && item?.content === "全仓回归测试")
    .map(({ index }) => index);
  const userMetaIndex = ctx.messages.findIndex((item) =>
    String(item?.content || "").startsWith("[用户元信息]"),
  );

  assert.deepEqual(userTextIndexes, [userMetaIndex - 1]);
});

test("capability runtime does not remove same-text user from a different turn", async () => {
  const runtime = createCapabilityRuntime({
    profile: {
      planning: { enabled: false },
      guidance: { enabled: false },
      acceptance: { enabled: false },
      review: { enabled: false },
    },
  });
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [
        {
          role: "user",
          content: "全仓回归测试",
          dialogProcessId: "d-old",
          additional_kwargs: { turnScopeId: "client-turn:old" },
        },
        { role: "assistant", content: "历史回答", dialogProcessId: "d-old" },
      ],
      incremental: [
        {
          role: "user",
          content: "全仓回归测试",
          additional_kwargs: { turnScopeId: "client-turn:current", frontendUserMessage: true },
        },
        {
          role: "user",
          content: "[用户元信息]\n{}",
          additional_kwargs: { turnScopeId: "client-turn:current" },
        },
      ],
    },
    agentContext: {
      execution: {
        controllers: {
          runtime: {},
        },
      },
    },
  };

  await runtime.runHook("before_llm_call", ctx, {
    harness: { resolveModelMessages: resolveFromBlocks },
  });

  const userTextIndexes = ctx.messages
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.role === "user" && item?.content === "全仓回归测试")
    .map(({ index }) => index);

  assert.deepEqual(userTextIndexes, [1, 3]);
});


test("capability runtime keeps later flows running when one flow fails", async () => {
  const calls = [];
  const runtime = createCapabilityRuntime({
    handlers: {
      planning: async () => {
        calls.push("planning");
        throw Object.assign(new Error("planning boom"), { code: "PLANNING_BOOM" });
      },
      guidance: async () => {
        calls.push("guidance");
        return { capability: "guidance", status: "active", changed: true };
      },
      acceptance: async () => {
        calls.push("acceptance");
        return { capability: "acceptance", status: "active", changed: false };
      },
    },
    profile: {
      review: { enabled: false },
    },
  });
  const agentContext = {
    payload: {
      harness: {
        state: {
          flags: { planningCaptured: true },
        },
      },
    },
  };
  const results = await runtime.runHook("before_llm_call", { agentContext, messages: [] }, {});

  assert.deepEqual(calls, ["planning", "guidance", "acceptance"]);
  assert.equal(results[0]?.status, "error");
  assert.equal(results[0]?.error?.code, "PLANNING_BOOM");
  assert.equal(results[1]?.capability, "guidance");
  assert.equal(results[2]?.capability, "acceptance");
  assert.equal(
    agentContext.payload.harness.logs.planning.some((item = {}) => item.event === "capability_flow_failed"),
    true,
  );
});
