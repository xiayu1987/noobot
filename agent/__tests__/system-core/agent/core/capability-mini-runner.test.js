import test from "node:test";
import assert from "node:assert/strict";

import { createAgentCapabilityModelInvoker } from "../../../../src/system-core/agent/core/capability-mini-runner/index.js";

test("capability mini-runner uses fallback configs when runtime is missing", async () => {
  const calls = [];
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    fallbackGlobalConfig: { providers: { p1: { model: "m1" } } },
    fallbackUserConfig: { defaultProvider: "p1" },
    createChatModelByNameFn: (name, options = {}) => {
      calls.push({ name, options });
      return {
        async invoke() {
          return { content: "ok" };
        },
      };
    },
  });

  const result = await invoker({
    model: "GLM_5_1",
    purpose: "workflow_semantic",
    domain: "botPlugin",
    ctx: {},
    messages: [{ role: "user", content: "你好" }],
  });

  assert.equal(result.output, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "GLM_5_1");
  assert.deepEqual(calls[0]?.options?.globalConfig, { providers: { p1: { model: "m1" } } });
  assert.deepEqual(calls[0]?.options?.userConfig, { defaultProvider: "p1" });
});
