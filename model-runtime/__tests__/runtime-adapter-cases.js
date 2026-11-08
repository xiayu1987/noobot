/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bindOpenAiCompatibleTools,
  compileProviderModelKwargs,
  createOpenAiCompatibleClient,
  applyPromptCacheMessages,
  orderOpenAiResponsesRequestBody,
  normalizeModelOutput,
} from "../src/index.js";
import {
  MODEL_ERROR_CODE,
  MODEL_ERROR_KIND,
  MODEL_RESPONSE_SOURCE,
  ModelProtocolError,
} from "@noobot/model-protocol";
import { openAiCompatibleAdapter } from "../src/adapters/openai-compatible-adapter.js";
import { classifyTransportError } from "../src/policies/default-retry-policy.js";
import { HumanMessage } from "@langchain/core/messages";

const sdkTool = {
  type: "function",
  function: {
    name: "execute_script",
    description: "execute script",
    parameters: { type: "object", properties: {} },
  },
};

test("model output keeps Responses reasoning and complete output sequence for continuation", () => {
  const output = normalizeModelOutput(
    {
      content: [
        { type: "reasoning", reasoning: "summary" },
        { type: "text", text: "done" },
      ],
      additional_kwargs: {
        reasoning: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
      },
      response_metadata: {
        output: [
          { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
          {
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: "read_file",
            arguments: "{}",
          },
        ],
        status: "completed",
      },
    },
    MODEL_RESPONSE_SOURCE.RESPONSES,
  );
  assert.deepEqual(output.responseOutput, [
    { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
    { id: "fc_1", type: "function_call", call_id: "call_1", name: "read_file", arguments: "{}" },
  ]);
  assert.deepEqual(output.responseReasoning, {
    id: "rs_1",
    type: "reasoning",
    encrypted_content: "encrypted",
    summary: [],
  });
  assert.equal(output.responseOutput[1].type, "function_call");
});

test("Responses streamed invocation uses terminal arguments even without argument deltas", async () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    streaming: true,
    modelSpec: {
      model: "gpt-6-astra",
      use_responses_api: true,
      base_url: "http://localhost",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  });
  const item = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "execute_script",
    arguments: '{"command":"pwd","riskLevel":"low"}',
  };
  client.responses.client = {
    responses: {
      async *create() {
        yield {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: "" },
        };
        yield { type: "response.output_item.done", output_index: 0, item };
        yield {
          type: "response.completed",
          response: { id: "resp_1", model: "gpt-6-astra", status: "completed", output: [item] },
        };
      },
    },
  };
  const message = await client.invoke([new HumanMessage("inspect")]);
  assert.deepEqual(message.tool_calls[0].args, {});
  const output = normalizeModelOutput(message, MODEL_RESPONSE_SOURCE.RESPONSES);
  assert.deepEqual(output.toolCalls, [
    { id: "call_1", name: "execute_script", args: { command: "pwd", riskLevel: "low" } },
  ]);
});

test("Responses terminal projection preserves custom and computer calls", () => {
  const output = normalizeModelOutput(
    {
      response_metadata: {
        output: [
          { type: "custom_tool_call", call_id: "custom", name: "grammar", input: "raw input" },
          { type: "computer_call", call_id: "computer", action: { type: "click", x: 1, y: 2 } },
          { type: "web_search_call", id: "provider-managed" },
        ],
        status: "completed",
      },
    },
    MODEL_RESPONSE_SOURCE.RESPONSES,
  );
  assert.deepEqual(output.toolCalls, [
    { id: "custom", name: "grammar", args: { input: "raw input" } },
    { id: "computer", name: "computer_use", args: { action: { type: "click", x: 1, y: 2 } } },
  ]);
});

test("OpenAI Responses requests serialize stable settings and tools before input", async () => {
  const ordered = orderOpenAiResponsesRequestBody({
    input: [{ role: "user", content: "incremental" }],
    model: "gpt-6-astra",
    temperature: 0.7,
    tools: [sdkTool],
    tool_choice: "auto",
  });

  assert.deepEqual(Object.keys(ordered), ["model", "temperature", "tools", "tool_choice", "input"]);
  assert.equal(
    JSON.stringify(ordered).indexOf('"tools"') < JSON.stringify(ordered).indexOf('"input"'),
    true,
  );

  let transportedRequest = null;
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "gpt-6-astra",
      operatorId: "openai",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
      use_responses_api: true,
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  });
  client.responses.client = {
    responses: {
      async create(request) {
        transportedRequest = request;
        return { id: "resp_test", status: "completed", output: [], output_text: "" };
      },
    },
  };
  const result = await client.responses.completionWithRetry({
    input: [{ role: "user", content: "incremental" }],
    model: "gpt-6-astra",
    tools: [sdkTool],
  });

  assert.equal(result.id, "resp_test");
  assert.deepEqual(Object.keys(transportedRequest), ["model", "tools", "input"]);
});

function responsesStreamClient(events) {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "gpt-6-astra",
      operatorId: "openai",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
      use_responses_api: true,
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  });
  client.responses.client = {
    responses: {
      async create() {
        return (async function* stream() {
          yield* events;
        })();
      },
    },
  };
  return client;
}

async function drainResponsesStream(client) {
  const stream = await client.responses.completionWithRetry({ input: [], stream: true });
  for await (const event of stream) void event;
}

for (const [code, classification] of [
  ["server_error", { kind: MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE, retryable: true }],
  ["rate_limit_exceeded", { kind: MODEL_ERROR_KIND.RATE_LIMIT, retryable: true }],
  ["invalid_prompt", { kind: MODEL_ERROR_KIND.UNKNOWN, retryable: false }],
]) {
  test(`OpenAI Responses stream classifies response.failed ${code}`, async () => {
    const message = `upstream ${code}`;
    const client = responsesStreamClient([
      {
        type: "response.failed",
        sequence_number: 0,
        response: { id: "resp_failed", status: "failed", error: { code, message } },
      },
    ]);
    const error = await drainResponsesStream(client).then(
      () => assert.fail("response.failed must reject the stream"),
      (value) => value,
    );
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.deepEqual(openAiCompatibleAdapter.classifyError(error), classification);
  });
}

test("Responses failure codes stay scoped to the OpenAI adapter", () => {
  assert.deepEqual(classifyTransportError({ code: "server_error" }), {
    kind: MODEL_ERROR_KIND.UNKNOWN,
    retryable: false,
  });
});

test("OpenAI Responses stream rejects response.failed without upstream error facts", async () => {
  const client = responsesStreamClient([
    { type: "response.failed", response: { id: "resp_failed", status: "failed" } },
  ]);
  await assert.rejects(drainResponsesStream(client), (error) => {
    assert.equal(error instanceof ModelProtocolError, true);
    assert.equal(error.code, MODEL_ERROR_CODE.PROTOCOL);
    return true;
  });
});

test("openai-compatible adapter applies bound invocation overrides without mutating model defaults", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "gpt-5.5",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      operatorId: "openai",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
      reasoning_effort: "high",
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool], {}, { reasoning_effort: "low" });

  assert.equal(client.invocationParams({}).reasoning_effort, "high");
  assert.equal(bound.invocationParams({}).reasoning_effort, "low");
});

test("bound OpenAI Responses clients preserve stable fields before input", async () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "gpt-6-astra",
      base_url: "http://localhost",
      use_responses_api: true,
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool]);
  let transportedRequest = null;
  bound.responses.client = {
    responses: {
      async create(request) {
        transportedRequest = request;
        return { id: "resp_bound_test", status: "completed", output: [], output_text: "" };
      },
    },
  };

  await bound.responses.completionWithRetry({
    input: [{ role: "user", content: "incremental" }],
    model: "gpt-6-astra",
    tools: [sdkTool],
  });

  assert.deepEqual(Object.keys(transportedRequest), ["model", "tools", "input"]);
});

test("openai-compatible cache protocol generates only explicitly selected fields", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    flow: "agent.main",
    modelSpec: {
      model: "gpt-5.6-sol",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      modelFamily: "gpt",
      operatorId: "generic",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
    },
  });
  const params = client.invocationParams({});

  assert.equal(params.prompt_cache_key, undefined);
  assert.equal(params.prompt_cache_options, undefined);

  const declaredClient = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "vendor-routed-model",
      base_url: "http://localhost",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["low", "medium", "high"],
      prompt_cache_fields: ["prompt_cache_key", "prompt_cache_options", "prompt_cache_retention"],
    },
  });
  const declaredParams = declaredClient.invocationParams({});
  assert.equal(declaredParams.prompt_cache_key, "noobot-main-vendor-routed-model");
  assert.deepEqual(declaredParams.prompt_cache_options, { ttl: "30m" });
  assert.equal(declaredParams.prompt_cache_retention, "24h");
});

test("official OpenAI chat requests use the current completion token limit field", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "gpt-4.1",
      base_url: "https://api.openai.com/v1",
      max_tokens: 2048,
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
    },
  });
  const params = client.invocationParams({});

  assert.equal(params.max_completion_tokens, 2048);
  assert.equal(params.max_tokens, undefined);
});

test("xAI Grok cache protocol uses only the x-grok-conv-id header", () => {
  const grok = compileProviderModelKwargs(
    {
      operatorId: "generic",
      adapterId: "openai-compatible",
      model: "grok-4.6",
      prompt_cache_fields: ["prompt_cache_key"],
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      modelFamily: "grok",
    },
    "agent.main",
  );

  assert.equal("prompt_cache_key" in grok, false);
  assert.equal("prompt_cache_retention" in grok, false);
  assert.equal("prompt_cache_options" in grok, false);
  const grokClient = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "grok-4.6",
      base_url: "http://localhost",
      prompt_cache_fields: ["prompt_cache_key"],
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh"],
    },
  });
  assert.equal(grokClient.clientConfig.defaultHeaders["x-grok-conv-id"], "noobot-main-grok-4-6");
});

test("normalized Grok clients use the xAI cache key protocol for each flow", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    flow: "plugin.analysis",
    modelSpec: {
      model: "grok-4.6",
      prompt_cache_fields: ["prompt_cache_key"],
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      base_url: "http://localhost",
    },
  });
  const params = client.invocationParams({});

  assert.equal(params.prompt_cache_key, undefined);
  assert.equal(params.prompt_cache_options, undefined);
  assert.equal(params.prompt_cache_retention, undefined);
  assert.equal(
    client.clientConfig.defaultHeaders["x-grok-conv-id"],
    "noobot-plugin-analysis-grok-4-6",
  );
});

test("Grok omits the cache routing header when cache fields are not selected", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "grok-4.6",
      prompt_cache_fields: [],
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      base_url: "http://localhost",
    },
  });

  assert.equal(client.clientConfig.defaultHeaders["x-grok-conv-id"], undefined);
});

test("Grok Responses maps the selected cache key to the body instead of the chat header", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    flow: "plugin.analysis",
    modelSpec: {
      model: "grok-4.6",
      use_responses_api: true,
      prompt_cache_fields: ["prompt_cache_key"],
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high", "xhigh", "max"],
      base_url: "http://localhost",
    },
  });

  assert.equal(client.invocationParams({}).prompt_cache_key, "noobot-plugin-analysis-grok-4-6");
  assert.equal(client.clientConfig.defaultHeaders["x-grok-conv-id"], undefined);
});

test("Qwen uses the canonical OpenAI-compatible invocation", () => {
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    modelSpec: {
      model: "qwen3.6-plus",
      reasoning_effort_parameter: "enable_thinking",
      reasoning_effort_options: ["none", "medium"],
      operatorId: "generic",
      adapterId: "openai-compatible",
      base_url: "http://localhost",
    },
  });
  const bound = bindOpenAiCompatibleTools(client, [sdkTool], {}, { reasoning_effort: "low" });
  const params = bound.invocationParams({});

  assert.equal(params.reasoning_effort, "low");
});

test("Claude uses top-level automatic caching and Qwen uses message-level caching", () => {
  const messages = [
    { role: "system", content: "stable instructions" },
    { role: "user", content: "question" },
  ];
  const marked = applyPromptCacheMessages(
    { model: "claude-sonnet-5", modelFamily: "claude" },
    messages,
  );
  assert.deepEqual(marked, messages);
  assert.deepEqual(
    compileProviderModelKwargs({
      operatorId: "anthropic",
      model: "claude-sonnet-5",
      modelFamily: "claude",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["low", "medium", "high"],
      prompt_cache_fields: ["cache_control"],
    }),
    {
      cache_control: { type: "ephemeral" },
    },
  );
  const qwenBlocks = applyPromptCacheMessages(
    {
      model: "qwen3.7-max",
      modelFamily: "qwen",
      prompt_cache_fields: ["cache_control"],
    },
    [
      {
        role: "system",
        content: [
          { type: "text", text: "a" },
          { type: "image_url", image_url: "x" },
        ],
      },
    ],
  );
  assert.deepEqual(qwenBlocks[0].content[0], {
    type: "text",
    text: "a",
    cache_control: { type: "ephemeral" },
  });
  assert.deepEqual(qwenBlocks[0].content[1], { type: "image_url", image_url: "x" });
});

function modeMismatchClient({ streaming, useResponsesApi, contentType, body }) {
  const calls = [];
  const client = createOpenAiCompatibleClient({
    credential: "test-key",
    streaming,
    modelSpec: {
      model: "gpt-6-astra",
      operatorId: "openai",
      adapterId: "openai-compatible",
      base_url: "http://localhost/v1",
      use_responses_api: useResponsesApi,
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
    },
    fetch: async (url) => {
      calls.push(url);
      return new Response(body, { status: 200, headers: { "content-type": contentType } });
    },
  });
  return { client, calls };
}

for (const useResponsesApi of [true, false]) {
  const api = useResponsesApi ? "Responses" : "Completions";
  for (const streaming of [false, true]) {
    test(`OpenAI ${api} rejects a ${streaming ? "JSON" : "SSE"} answer to a ${
      streaming ? "stream" : "non-stream"
    } request without SDK retries`, async () => {
      const { client, calls } = modeMismatchClient({
        streaming,
        useResponsesApi,
        contentType: streaming ? "application/json" : "text/event-stream",
        body: streaming ? '{"id":"resp_json"}' : 'data: {"id":"resp_sse"}\n\n',
      });
      await assert.rejects(client.invoke([new HumanMessage("hi")]), (error) => {
        assert.equal(error instanceof ModelProtocolError, true);
        assert.equal(error.code, MODEL_ERROR_CODE.RESPONSE_MODE_MISMATCH);
        assert.equal(error.kind, MODEL_ERROR_KIND.RESPONSE_MODE_MISMATCH);
        assert.equal(error.details.requestedStreaming, streaming);
        return true;
      });
      assert.equal(calls.length, 1);
    });
  }
}
