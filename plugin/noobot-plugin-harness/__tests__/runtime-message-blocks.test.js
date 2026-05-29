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
