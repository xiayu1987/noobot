/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChatOpenAI } from "@langchain/openai";
import {
  createOpenAiCompatibleClient,
  bindOpenAiCompatibleTools,
  openAiCompatibleAdapter,
} from "../src/adapters/openai-compatible-adapter.js";
import { normalizeModelResponse } from "../src/normalization/response-normalizer.js";
import { MODEL_RESPONSE_SOURCE } from "@noobot/model-protocol";

const modelSpec = {
  model: "gpt-4o-mini",
  operatorId: "openai",
  adapterId: "openai-compatible",
  use_responses_api: false,
  reasoning_effort: "none",
  reasoning_effort_options: ["none"],
  reasoning_effort_parameter: "reasoning_effort",
};

function response(tool) {
  const deltas = tool
    ? [
        {
          tool_calls: [
            { index: 0, id: "call-1", type: "function", function: { name: "run", arguments: "" } },
          ],
        },
        { tool_calls: [{ index: 0, function: { arguments: '{"value":' } }] },
        { tool_calls: [{ index: 0, function: { arguments: "7}" } }] },
      ]
    : [{ content: "first" }, { content: " second" }];
  const events = deltas.map((delta, index) => ({
    choices: [
      {
        index: 0,
        delta: index === 0 ? { role: "assistant", ...delta } : delta,
        finish_reason: null,
      },
    ],
  }));
  events.push({ choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] });
  events.push({
    choices: [],
    usage: { prompt_tokens: 23, completion_tokens: 4, total_tokens: 27 },
  });
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

for (const tool of [false, true]) {
  test(`stream invocation preserves output and callbacks without prompt estimation: tool=${tool}`, async () => {
    const outputs = [];
    const callbackResults = [];
    for (const reference of [true, false]) {
      const base = createOpenAiCompatibleClient({
        modelSpec,
        credential: "test",
        streaming: true,
        fetch: async () => response(tool),
      });
      const client = tool
        ? bindOpenAiCompatibleTools(base, [
            {
              type: "function",
              function: {
                name: "run",
                parameters: { type: "object", properties: { value: { type: "number" } } },
              },
            },
          ])
        : base;
      let estimates = 0;
      client.completions.getNumTokens = async () => {
        estimates += 1;
        return 1;
      };
      const tokens = [];
      const terminal = [];
      const invoke = reference
        ? ChatOpenAI.prototype.invoke.bind(client)
        : (messages, invokeOptions) =>
            openAiCompatibleAdapter.invokeChat({
              client,
              messages,
              invokeOptions,
              streaming: true,
            });
      const result = await invoke([{ role: "user", content: "context" }], {
        runId: "00000000-0000-4000-8000-000000000001",
        callbacks: [
          {
            handleLLMNewToken: (token) => tokens.push(token),
            handleLLMEnd: (output) => {
              terminal.push(output);
            },
          },
        ],
      });
      if (reference) assert.ok(estimates > 0);
      else {
        assert.equal(estimates, 0);
        assert.deepEqual(terminal[0].llmOutput, {
          tokenUsage: { promptTokens: 23, completionTokens: 4, totalTokens: 27 },
        });
      }
      assert.equal(terminal.length, 1);
      assert.deepEqual(result.usage_metadata, {
        input_tokens: 23,
        output_tokens: 4,
        total_tokens: 27,
        input_token_details: {},
        output_token_details: {},
      });
      outputs.push(normalizeModelResponse(result, MODEL_RESPONSE_SOURCE.MESSAGE));
      callbackResults.push({
        tokens,
        terminal: normalizeModelResponse(
          terminal[0].generations[0][0].message,
          MODEL_RESPONSE_SOURCE.MESSAGE,
        ),
      });
    }
    assert.deepEqual(outputs[1], outputs[0]);
    assert.deepEqual(callbackResults[1], callbackResults[0]);
  });
}

for (const failure of ["aborted", "incomplete", "provider"]) {
  test(`stream invocation preserves ${failure} failure and terminal callbacks`, async () => {
    const observations = [];
    for (const reference of [true, false]) {
      const controller = new AbortController();
      if (failure === "aborted") controller.abort();
      const client = createOpenAiCompatibleClient({
        modelSpec,
        credential: "test",
        streaming: true,
        fetch: async () => {
          if (failure === "provider")
            return Response.json(
              { error: { message: "unavailable", type: "server_error", code: "server_error" } },
              { status: 503 },
            );
          return new Response(
            'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"partial"},"finish_reason":null}]}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
      const events = [];
      const errorCallback = Promise.withResolvers();
      const invoke = reference
        ? ChatOpenAI.prototype.invoke.bind(client)
        : (messages, invokeOptions) =>
            openAiCompatibleAdapter.invokeChat({
              client,
              messages,
              invokeOptions,
              streaming: true,
            });
      await assert.rejects(
        invoke("context", {
          signal: controller.signal,
          callbacks: [
            {
              handleLLMError: () => {
                events.push("error");
                errorCallback.resolve();
              },
              handleLLMEnd: () => events.push("end"),
            },
          ],
        }),
        (error) => {
          observations.push({ name: error.name, code: error.code, status: error.status, events });
          return true;
        },
      );
      await errorCallback.promise;
      assert.deepEqual(events, ["error"]);
    }
    assert.deepEqual(observations[1], observations[0]);
  });
}

test("stream invocation preserves Responses terminal output and callbacks", async () => {
  const outputs = [];
  for (const reference of [true, false]) {
    const terminal = {
      id: "resp-1",
      status: "completed",
      output: [
        {
          type: "message",
          id: "msg-1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "done", annotations: [] }],
        },
      ],
    };
    const client = createOpenAiCompatibleClient({
      modelSpec: { ...modelSpec, use_responses_api: true },
      credential: "test",
      streaming: true,
      fetch: async () =>
        new Response(
          `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: terminal })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    let ended = 0;
    const invoke = reference
      ? ChatOpenAI.prototype.invoke.bind(client)
      : (messages, invokeOptions) =>
          openAiCompatibleAdapter.invokeChat({ client, messages, invokeOptions, streaming: true });
    const result = await invoke("context", {
      callbacks: [
        {
          handleLLMEnd: () => {
            ended += 1;
          },
        },
      ],
    });
    assert.equal(ended, 1);
    outputs.push(normalizeModelResponse(result, MODEL_RESPONSE_SOURCE.RESPONSES));
  }
  assert.deepEqual(outputs[1], outputs[0]);
  assert.deepEqual(outputs[1].output.responseOutput[0].content[0].text, "done");
});
