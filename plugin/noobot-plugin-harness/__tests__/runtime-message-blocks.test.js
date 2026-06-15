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
