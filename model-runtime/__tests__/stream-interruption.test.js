/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor, openAiCompatibleAdapter } from "../src/index.js";
import OpenAI, { APIError } from "openai";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_RESPONSE_SOURCE } from "@noobot/model-protocol";
import { partialOutputResponse, consumePartialOutput } from "./runtime-fixtures.js";

for (const scenario of ["recover", "exhaust", "unknown", "partial"]) {
  test(`stream interruption ${scenario} preserves request mode and failure facts`, async () => {
    const modes = [];
    const events = [];
    let calls = 0;
    const failure =
      scenario === "unknown"
        ? new Error("unclassified provider failure")
        : new APIError(undefined, {
            code: "server_error",
            message: "Upstream response stream was interrupted",
          });
    const adapter = {
      id: "openai-compatible",
      classifyError: openAiCompatibleAdapter.classifyError,
      bindTools: ({ client }) => client,
      prepareMessages: ({ messages }) => messages,
      resolveResponseSource: () => MODEL_RESPONSE_SOURCE.MESSAGE,
      createClient: ({ streaming, fetch }) => {
        modes.push(streaming);
        return {
          invoke: async () => {
            calls += 1;
            if (scenario === "partial") {
              await consumePartialOutput(fetch);
            }
            if (scenario === "recover" && calls > 1) return { content: "ok" };
            throw failure;
          },
        };
      },
    };
    const executor = createModelRequestExecutor({
      registry: { resolve: () => adapter },
      credentialPort: { resolve: () => "test-secret" },
      observationPort: { emit: (event) => events.push(event) },
      clock: { now: () => 0, sleep: async () => {} },
      providerRuntime: { fetchImpl: async () => partialOutputResponse() },
    });
    const invoke = () =>
      executor.invoke({
        invocation: {
          requestId: "r",
          invocationId: "i",
          sessionId: "s",
          parentSessionId: "",
          dialogProcessId: "d",
          turnScopeId: "t",
          runId: "run",
          flow: "test",
          purpose: "test",
          domain: "test",
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
        model: { model: "m", operatorId: "openai", adapterId: "openai-compatible" },
        messages: [],
        options: { streaming: true },
        policies: { retry: { maxTotalAttempts: 3, transport: { maxAttempts: 2, baseDelayMs: 0 } } },
      });
    if (scenario === "recover") assert.equal((await invoke()).output.text, "ok");
    else await assert.rejects(invoke(), (error) => error.message === failure.message);
    assert.equal(calls, scenario === "partial" ? 1 : 2);
    assert.deepEqual(modes, [true]);
    assert.equal(events.includes("model.invocation.streaming_mode_retry"), false);
  });
}

test("SDK preserves a documented SSE server_error for provider classification", async () => {
  const event = {
    type: "error",
    code: "server_error",
    message: "Upstream response stream was interrupted",
  };
  const client = new OpenAI({
    apiKey: "test-secret",
    maxRetries: 0,
    fetch: async () =>
      new Response(`event: error\ndata: ${JSON.stringify(event)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
  });
  const stream = await client.responses.create({ model: "test", input: "test", stream: true });
  await assert.rejects(
    async () => {
      for await (const item of stream) assert.fail(`unexpected event: ${item.type}`);
    },
    (error) => {
      assert.equal(error instanceof APIError, true);
      assert.equal(error.code, event.code);
      assert.deepEqual(openAiCompatibleAdapter.classifyError(error, { operatorId: "openai" }), {
        kind: "temporary_unavailable",
      });
      return true;
    },
  );
  assert.deepEqual(
    openAiCompatibleAdapter.classifyError(new APIError(401, event), { operatorId: "openai" }),
    { kind: "authentication" },
  );
});
