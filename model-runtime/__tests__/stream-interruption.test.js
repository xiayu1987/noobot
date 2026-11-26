/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor, openAiCompatibleAdapter } from "../src/index.js";
import OpenAI, { APIError } from "openai";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_INVOCATION_EVENT,
  MODEL_RESPONSE_SOURCE,
} from "@noobot/model-protocol";
import { invocation, partialOutputResponse, consumePartialOutput } from "./runtime-fixtures.js";

for (const scenario of [
  "recover",
  "exhaust",
  "unknown",
  "partial",
  "body-timeout-recover",
  "body-timeout-exhaust",
  "body-timeout-partial",
]) {
  test(`stream interruption ${scenario} preserves request mode and failure facts`, async () => {
    const modes = [];
    const events = [];
    let calls = 0;
    const failure = scenario.startsWith("body-timeout-")
      ? new TypeError("terminated", { cause: { code: "UND_ERR_BODY_TIMEOUT" } })
      : scenario === "unknown"
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
      invokeChat: ({ client, messages, invokeOptions }) => client.invoke(messages, invokeOptions),
      resolveResponseSource: () => MODEL_RESPONSE_SOURCE.MESSAGE,
      createClient: ({ streaming, fetch }) => {
        modes.push(streaming);
        return {
          invoke: async () => {
            calls += 1;
            if (scenario.endsWith("partial")) {
              await consumePartialOutput(fetch);
            }
            if (scenario.endsWith("recover") && calls > 1) return { content: "ok" };
            throw failure;
          },
        };
      },
    };
    const executor = createModelRequestExecutor({
      registry: { resolve: () => adapter },
      credentialPort: { resolve: () => "test-secret" },
      observationPort: { emit: (type, payload) => events.push({ type, payload }) },
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
        model: {
          model: "m",
          operatorId: scenario.startsWith("body-timeout-") ? "generic" : "openai",
          adapterId: "openai-compatible",
        },
        messages: [],
        options: { streaming: true },
        policies: { retry: { maxTotalAttempts: 3, transport: { maxAttempts: 2, baseDelayMs: 0 } } },
      });
    if (scenario.endsWith("recover")) assert.equal((await invoke()).output.text, "ok");
    else await assert.rejects(invoke(), (error) => error.message === failure.message);
    assert.equal(calls, scenario.endsWith("partial") ? 1 : 2);
    assert.deepEqual(modes, [true]);
    assert.equal(
      events.some(({ type }) => type === MODEL_INVOCATION_EVENT.STREAMING_MODE_RETRY),
      false,
    );
    assert.equal(
      events.filter(({ type }) => type === MODEL_INVOCATION_EVENT.RETRY_SCHEDULED).length,
      calls - 1,
    );
    const terminalFailure = events.find(({ type }) => type === MODEL_INVOCATION_EVENT.FAILED);
    if (scenario.endsWith("recover")) {
      assert.equal(terminalFailure, undefined);
    } else {
      assert.deepEqual(terminalFailure.payload.recoveryContext, {
        outputObserved: scenario.endsWith("partial"),
        maxTotalAttempts: 3,
        transportMaxAttempts: 2,
        retryAfterMs: null,
      });
    }
  });
}

for (const { label, operatorId, kind, failure, retryable, outputObserved } of [
  {
    label: "empty SSE stream without provider error",
    operatorId: "generic",
    kind: "protocol",
    failure: null,
    retryable: true,
  },
  {
    label: "generic gateway body timeout",
    operatorId: "generic",
    kind: "timeout",
    failure: new TypeError("terminated", { cause: { code: "UND_ERR_BODY_TIMEOUT" } }),
    retryable: true,
  },
  {
    label: "generic gateway unknown termination",
    operatorId: "generic",
    kind: "unknown",
    failure: new TypeError("terminated"),
    retryable: true,
  },
  {
    label: "OpenAI documented server error",
    operatorId: "openai",
    kind: "temporary_unavailable",
    failure: new APIError(undefined, { code: "server_error", message: "server failed" }),
    retryable: true,
  },
  {
    label: "OpenAI documented exhausted quota",
    operatorId: "openai",
    kind: "quota_exhausted",
    failure: new APIError(undefined, { code: "insufficient_quota", message: "quota exhausted" }),
    retryable: false,
  },
].flatMap((scenario) =>
  (scenario.failure ? [false, true] : [false]).map((outputObserved) => ({
    ...scenario,
    outputObserved,
  })),
)) {
  test(`${label} through Chat adapter: outputObserved=${outputObserved}`, async () => {
    const events = [];
    const requests = [];
    const shouldReplay = retryable && !outputObserved;
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "test-secret" },
      observationPort: { emit: (type, payload) => events.push({ type, payload }) },
      clock: { now: () => 0, sleep: async () => {} },
      providerRuntime: {
        fetchImpl: async (_url, init) => {
          requests.push(init.body);
          if (requests.length > 1) return partialOutputResponse();
          if (failure === null) {
            return new Response("data: [DONE]\n\n", {
              headers: { "content-type": "text/event-stream" },
            });
          }
          const delta = outputObserved ? { reasoning_content: "thinking" } : { role: "assistant" };
          const event = { choices: [{ index: 0, delta, finish_reason: null }] };
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
              },
              pull(controller) {
                controller.error(failure);
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      },
    });
    const invoke = () =>
      executor.invoke({
        invocation,
        model: {
          model: "gpt-test",
          operatorId,
          modelFamily: "gpt",
          adapterId: "openai-compatible",
          use_responses_api: false,
          base_url: "https://provider.test/v1",
          reasoning_effort: "none",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none"],
        },
        messages: [{ role: "user", content: "hello" }],
        options: { streaming: true },
      });
    if (!shouldReplay) {
      await assert.rejects(invoke(), (error) => error === failure);
      assert.equal(requests.length, 1);
      const { payload } = events.find(({ type }) => type === MODEL_INVOCATION_EVENT.FAILED);
      assert.equal(payload.kind, kind);
      assert.equal(payload.recoveryContext.outputObserved, outputObserved);
    } else {
      const result = await invoke();
      assert.equal(result.output.text, "partial");
      assert.equal(result.execution.attempts[0].error.kind, kind);
      assert.deepEqual(requests, [requests[0], requests[0]]);
      assert.equal(
        events.some(({ type }) => type === MODEL_INVOCATION_EVENT.FAILED),
        false,
      );
    }
    assert.equal(JSON.parse(requests[0]).stream, true);
    assert.equal(
      events.filter(({ type }) => type === MODEL_INVOCATION_EVENT.RETRY_SCHEDULED).length,
      shouldReplay ? 1 : 0,
    );
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
      const classification = openAiCompatibleAdapter.classifyError(error, { operatorId: "openai" });
      assert.equal(classification.kind, "temporary_unavailable");
      assert.equal(classification.providerEvidence.recognized, true);
      assert.equal(classification.providerEvidence.modeRelated, false);
      return true;
    },
  );
  assert.deepEqual(
    openAiCompatibleAdapter.classifyError(new APIError(401, event), { operatorId: "openai" }).kind,
    "authentication",
  );
});
