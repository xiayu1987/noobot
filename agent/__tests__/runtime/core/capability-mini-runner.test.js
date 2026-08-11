/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentCapabilityModelInvoker } from "../../../src/runtime/capability-runner/index.js";

test("capability mini-runner requires and uses the host ModelPort", async () => {
  const calls = [];
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    resolveModelSpecByNameFn: ({ modelName }) => ({
      alias: modelName,
      model: "glm-5.1",
      format: "openai_compatible",
      providerId: "zhipu",
      adapterId: "openai-compatible",
    }),
  });

  const runtime = {
    globalConfig: {},
    userConfig: {},
    systemRuntime: {},
    modelPort: {
      async invoke(request) {
        calls.push(request);
        return { output: { text: "ok", toolCalls: [] }, execution: { attemptCount: 1 } };
      },
    },
  };

  const result = await invoker({
    model: "GLM_5_1",
    purpose: "workflow_semantic",
    domain: "botPlugin",
    ctx: { agentContext: { bindings: { runtime } } },
    messages: [{ role: "user", content: "你好" }],
  });

  assert.equal(result.output.text, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model?.alias, "GLM_5_1");
  assert.equal(calls[0]?.invocation?.purpose, "workflow_semantic");
});
