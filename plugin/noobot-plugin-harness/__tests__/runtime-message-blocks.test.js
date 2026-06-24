import test from "node:test";
import assert from "node:assert/strict";

import { createCapabilityRuntime } from "../src/capabilities/runtime.js";

test("capability runtime composes before_llm_call messages from message blocks via resolver", async () => {
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
      history: [{ role: "assistant", content: "h1" }],
      incremental: [{ role: "user", content: "u1" }],
    },
  };
  const calls = [];
  await runtime.runHook("before_llm_call", ctx, {
    harness: {
      resolveMessageBlock: ({ scope = "", messages = [] } = {}) => {
        calls.push(scope);
        if (scope === "history") return [...messages, { role: "assistant", content: "h2" }];
        if (scope === "incremental") return messages.filter((item) => item?.role === "user");
        return messages;
      },
    },
  });

  assert.deepEqual(calls, ["system", "history", "incremental"]);
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
        { role: "assistant", content: "summarized-history", summarized: true },
        { role: "assistant", content: "active-history" },
      ],
      incremental: [
        { role: "assistant", content: "summarized-incremental", summarized: true },
        { role: "tool", content: "summarized-tool", lc_kwargs: { summarized: true } },
        { role: "user", content: "current user", additional_kwargs: { frontendUserMessage: true } },
      ],
    },
  };

  await runtime.runHook("before_llm_call", ctx, {});

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["sys", "active-history", "current user"],
  );
  assert.deepEqual(
    ctx.messageBlocks.incremental.map((item) => item.content),
    ["current user"],
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
    harness: {
      resolveMessageBlock: ({ messages = [] } = {}) => [summarized, ...messages],
    },
  });

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["current user"],
  );
  assert.deepEqual(
    ctx.messageBlocks.incremental.map((item) => item.content),
    ["current user"],
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
      history: [{ role: "assistant", content: "h1" }],
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
    harness: { resolveMessageBlock: ({ messages = [] } = {}) => messages },
  });
  assert.equal(ctx.messageBlocks, originalMessageBlocks);
  ctx.messages.push({ role: "assistant", content: "after-first-call" });
  await runtime.runHook("before_llm_call", ctx, {
    harness: { resolveMessageBlock: ({ messages = [] } = {}) => messages },
  });

  assert.deepEqual(
    ctx.messages.map((item) => item.content),
    ["sys1", "h1", "u1", "after-first-call"],
  );
});

test("capability runtime keeps current user once at incremental tail after block composition", async () => {
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
        { role: "assistant", content: "上一轮回答" },
        {
          role: "user",
          content: "全仓回归测试",
          additional_kwargs: { turnScopeId: "client-turn:current" },
        },
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
    harness: { resolveMessageBlock: ({ messages = [] } = {}) => messages },
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
          additional_kwargs: { turnScopeId: "client-turn:old" },
        },
        { role: "assistant", content: "历史回答" },
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
    harness: { resolveMessageBlock: ({ messages = [] } = {}) => messages },
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
  const agentContext = { payload: { harness: {} } };
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
