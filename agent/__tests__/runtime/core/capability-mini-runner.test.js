/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentCapabilityModelInvoker } from "../../../src/runtime/capability-runner/index.js";
import { createModelResponse, MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createConfigSnapshot } from "@noobot/agent-config-protocol";

test("capability mini-runner requires and uses the host ModelPort", async () => {
  const calls = [];
  let resolvedConfig = null;
  const invoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    configSnapshot: createConfigSnapshot({ config: { selectedModel: "GLM_5_1" } }),
    resolveModelSpecByNameFn: ({ modelName, globalConfig, userConfig }) => {
      resolvedConfig = { globalConfig, userConfig };
      return {
        alias: modelName,
        model: "glm-5.1",
        format: "openai_compatible",
        providerId: "zhipu",
        adapterId: "openai-compatible",
      };
    },
  });

  const runtime = {
    globalConfig: {},
    userConfig: {},
    systemRuntime: {},
    modelPort: {
      async invoke(request) {
        calls.push(request);
        const output = {
          text: "ok",
          reasoning: "",
          toolCalls: [],
          finishReason: "stop",
          usage: {},
        };
        return createModelResponse({
          invocation: {
            requestId: "request-1",
            invocationId: "invocation-1",
            sessionId: "session-1",
            parentSessionId: "",
            dialogProcessId: "dialog-1",
            turnScopeId: "turn-1",
            runId: "agent:turn-1",
            flow: request.invocation.flow,
            purpose: request.invocation.purpose,
            domain: request.invocation.domain,
            contextSequencePolicy:
              request.invocation.contextSequencePolicy ||
              MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
          },
          output,
          attempts: [
            {
              attempt: 1,
              status: "completed",
              kind: "response",
              streaming: false,
              output,
            },
          ],
          model: request.model,
          provider: {},
        });
      },
    },
  };

  const result = await invoker({
    model: "GLM_5_1",
    purpose: "workflow_semantic",
    domain: "botPlugin",
    ctx: {
      agentContext: createTestAgentExecutionScope(runtime, {
        identity: {
          sessionId: "session-1",
          dialogProcessId: "dialog-1",
          turnScopeId: "turn-1",
          runId: "agent:turn-1",
        },
      }),
    },
    messages: [{ role: "user", content: "你好" }],
  });

  assert.equal(result.output.text, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model?.alias, "GLM_5_1");
  assert.deepEqual(resolvedConfig, {
    globalConfig: { selectedModel: "GLM_5_1" },
    userConfig: {},
  });
  assert.equal(calls[0]?.invocation?.purpose, "workflow_semantic");
});

test("capability mini-runner fails closed without a versioned config snapshot", () => {
  assert.throws(
    () => createAgentCapabilityModelInvoker({ enableToolBinding: false }),
    /agent config snapshot must be an object/,
  );
  assert.throws(
    () =>
      createAgentCapabilityModelInvoker({
        enableToolBinding: false,
        configSnapshot: { protocol: "noobot.agent-config", version: 2 },
      }),
    /unsupported agent config protocol version/,
  );
});
