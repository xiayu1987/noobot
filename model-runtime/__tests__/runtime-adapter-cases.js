/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bindOpenAiCompatibleTools,
  compileProviderModelKwargs,
  createModelRequestExecutor,
  createOpenAiCompatibleClient,
  createProviderAdapterRegistry,
  applyPromptCacheMessages,
  convertMessages,
  convertToolChoice,
  convertTools,
  responseFromAnthropic,
  anthropicMessagesAdapter,
  classifyTransportError,
  orderOpenAiResponsesRequestBody,
  normalizeModelOutput,
} from "../src/index.js";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_ERROR_KIND,
  MODEL_OPERATION_KIND,
} from "@noobot/model-protocol";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const invocation = {
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
};
const model = {
  model: "m",
  operatorId: "test",
  adapterId: "test",
  capabilities: { web_search: true },
};

const sdkTool = {
  type: "function",
  function: {
    name: "execute_script",
    description: "execute script",
    parameters: { type: "object", properties: {} },
  },
};

test("model output keeps Responses reasoning and complete output sequence for continuation", () => {
  const output = normalizeModelOutput({
    content: [{ type: "reasoning", reasoning: "summary" }, { type: "text", text: "done" }],
    additional_kwargs: {
      reasoning: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
    },
    response_metadata: {
      output: [
        { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
        { id: "fc_1", type: "function_call", call_id: "call_1", name: "read_file", arguments: "{}" },
      ],
    },
  });
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


test("OpenAI Responses requests serialize stable settings and tools before input", async () => {
  const ordered = orderOpenAiResponsesRequestBody({
    input: [{ role: "user", content: "incremental" }],
    model: "gpt-6-astra",
    temperature: 0.7,
    tools: [sdkTool],
    tool_choice: "auto",
  });

  assert.deepEqual(Object.keys(ordered), [
    "model",
    "temperature",
    "tools",
    "tool_choice",
    "input",
  ]);
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
        return { id: "resp_test", output: [], output_text: "" };
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
        return { id: "resp_bound_test", output: [], output_text: "" };
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


test("openai-compatible GPT cache protocol is compiled independently of operator identity", () => {
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

  assert.equal(params.prompt_cache_key, "noobot-main-gpt-5-6-sol");
  assert.deepEqual(params.prompt_cache_options, { ttl: "30m" });
});


test("xAI Grok cache protocol uses only the x-grok-conv-id header", () => {
  const grok = compileProviderModelKwargs(
    {
      operatorId: "generic",
      adapterId: "openai-compatible",
      model: "grok-4.6",
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
    }),
    {
      prompt_cache_key: "noobot-main-claude-sonnet-5",
      prompt_cache_retention: "24h",
      cache_control: { type: "ephemeral" },
    },
  );
  const qwenBlocks = applyPromptCacheMessages({ model: "qwen3.7-max", modelFamily: "qwen" }, [
    {
      role: "system",
      content: [
        { type: "text", text: "a" },
        { type: "image_url", image_url: "x" },
      ],
    },
  ]);
  assert.deepEqual(qwenBlocks[0].content[0], {
    type: "text",
    text: "a",
    cache_control: { type: "ephemeral" },
  });
  assert.deepEqual(qwenBlocks[0].content[1], { type: "image_url", image_url: "x" });
});


test("Anthropic Messages adapter preserves tool-use/result protocol", () => {
  const messages = convertMessages([
    { role: "system", content: "rules" },
    { role: "user", content: "run it" },
    {
      role: "assistant",
      content: "I will run this.",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "run", arguments: JSON.stringify({ x: 1 }) } }],
    },
    { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ ok: true }) },
  ]);
  assert.deepEqual(messages.at(-2), {
    role: "assistant",
    content: [
      { type: "text", text: "I will run this." },
      { type: "tool_use", id: "call_1", name: "run", input: { x: 1 } },
    ],
  });
  assert.deepEqual(messages.at(-1), {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "call_1", content: JSON.stringify({ ok: true }) }],
  });
  assert.deepEqual(convertTools([sdkTool]), [
    { name: "execute_script", description: "execute script", input_schema: sdkTool.function.parameters },
  ]);
  assert.deepEqual(convertToolChoice("auto"), { type: "auto" });
  assert.deepEqual(convertToolChoice("required"), { type: "any" });
  assert.equal(createProviderAdapterRegistry().resolve({ adapterId: "anthropic-messages" }).id, "anthropic-messages");
});


test("Anthropic Messages adapter preserves LangChain system, assistant, and tool roles", () => {
  const messages = convertMessages([
    new SystemMessage("stable rules"),
    new HumanMessage("run it"),
    new AIMessage({
      content: "I will run this.",
      tool_calls: [{ id: "call_lc_1", name: "run", args: { x: 1 }, type: "tool_call" }],
    }),
    new ToolMessage({ tool_call_id: "call_lc_1", content: JSON.stringify({ ok: true }) }),
  ]);

  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "run it" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I will run this." },
        { type: "tool_use", id: "call_lc_1", name: "run", input: { x: 1 } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_lc_1", content: '{"ok":true}' }],
    },
  ]);
});


test("Anthropic Messages adapter preserves LangChain tool schemas", () => {
  const tool = new DynamicStructuredTool({
    name: "read_file",
    description: "Read a file",
    schema: z.object({ filePath: z.string() }),
    func: async () => "",
  });

  assert.deepEqual(convertTools([tool]), [
    {
      name: "read_file",
      description: "Read a file",
      input_schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { filePath: { type: "string" } },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
  ]);
});


test("Anthropic Messages preserves thinking blocks across tool-result turns", () => {
  const thinking = { type: "thinking", thinking: "reason", signature: "sig_1" };
  const toolUse = { type: "tool_use", id: "tool_1", name: "read_file", input: { filePath: "a" } };
  const response = responseFromAnthropic({
    role: "assistant",
    content: [thinking, toolUse],
    stop_reason: "tool_use",
    usage: {},
  });
  assert.deepEqual(response.content, [thinking, toolUse]);
  assert.deepEqual(convertMessages([
    { role: "assistant", content: response.content, tool_calls: response.tool_calls },
    { role: "tool", tool_call_id: "tool_1", content: "ok" },
  ]), [
    { role: "assistant", content: [thinking, toolUse] },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }],
    },
  ]);
});


test("Anthropic Messages adapter sends native endpoint and exposes cache usage", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 500 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = anthropicMessagesAdapter.createClient({
      credential: "sk-test",
      modelSpec: {
        model: "claude-fable-5-1",
        base_url: "https://api.anthropic.com",
        reasoning_effort: "none",
        reasoning_effort_options: ["none", "low", "medium", "high"],
        reasoning_effort_parameter: "reasoning_effort",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    });
    const boundClient = anthropicMessagesAdapter.bindTools({
      client,
      tools: [sdkTool],
      toolOptions: { tool_choice: "auto" },
    });
    const result = await boundClient.invoke([{ role: "user", content: "hello" }]);
    assert.equal(request.url, "https://api.anthropic.com/v1/messages");
    assert.equal(request.init.headers["x-api-key"], "sk-test");
    assert.deepEqual(request.body.cache_control, { type: "ephemeral", ttl: "1h" });
    assert.deepEqual(Object.keys(request.body), [
      "model",
      "max_tokens",
      "temperature",
      "tools",
      "tool_choice",
      "cache_control",
      "messages",
    ]);
    assert.equal(result.usage_metadata.cache_read_input_tokens, 500);
  } finally {
    globalThis.fetch = previousFetch;
  }
});


test("Anthropic Messages keeps reasoning/cache fields before the append-only messages field", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 });
  };
  try {
    const tool = new DynamicStructuredTool({
      name: "read_file",
      description: "Read a file",
      schema: z.object({ filePath: z.string() }),
      func: async () => "",
    });
    const client = anthropicMessagesAdapter.createClient({
      credential: "sk-test",
      modelSpec: {
        model: "claude-opus-5",
        base_url: "https://api.anthropic.com",
        reasoning_effort: "medium",
        reasoning_effort_options: ["low", "medium", "high"],
        reasoning_effort_parameter: "reasoning_effort",
        cache_control: { type: "ephemeral" },
      },
    });
    await anthropicMessagesAdapter.bindTools({
      client,
      tools: [tool],
      toolOptions: { tool_choice: "auto" },
    }).invoke([{ role: "system", content: "rules" }, { role: "user", content: "hello" }]);

    assert.deepEqual(Object.keys(request.body), [
      "model",
      "max_tokens",
      "tools",
      "tool_choice",
      "thinking",
      "output_config",
      "cache_control",
      "system",
      "messages",
    ]);
    assert.deepEqual(request.body.thinking, { type: "adaptive" });
    assert.deepEqual(request.body.output_config, { effort: "medium" });
    assert.deepEqual(request.body.cache_control, { type: "ephemeral" });
    assert.deepEqual(request.body.tools[0].input_schema.properties, {
      filePath: { type: "string" },
    });
    assert.deepEqual(request.body.tools[0].input_schema.required, ["filePath"]);
    assert.equal(request.body.messages[0].role, "user");
    assert.equal(request.body.system[0].text, "rules");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

