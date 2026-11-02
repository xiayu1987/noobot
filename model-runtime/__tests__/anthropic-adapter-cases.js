/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compileProviderModelKwargs,
  createProviderAdapterRegistry,
  convertMessages,
  convertToolChoice,
  convertTools,
  responseFromAnthropic,
  anthropicMessagesAdapter,
  mapAnthropicMultimodalAttachment,
} from "../src/index.js";

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool as structuredTool } from "@langchain/core/tools";
import { z } from "zod";

const sdkTool = {
  type: "function",
  function: {
    name: "execute_script",
    description: "execute script",
    parameters: { type: "object", properties: {} },
  },
};

test("Anthropic Messages adapter preserves tool-use/result protocol", () => {
  const messages = convertMessages([
    { role: "system", content: "rules" },
    { role: "user", content: "run it" },
    {
      role: "assistant",
      content: "I will run this.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "run", arguments: JSON.stringify({ x: 1 }) },
        },
      ],
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
    content: [
      { type: "tool_result", tool_use_id: "call_1", content: JSON.stringify({ ok: true }) },
    ],
  });
  assert.deepEqual(convertTools([sdkTool]), [
    {
      name: "execute_script",
      description: "execute script",
      input_schema: sdkTool.function.parameters,
    },
  ]);
  assert.deepEqual(convertToolChoice("auto"), { type: "auto" });
  assert.deepEqual(convertToolChoice("required"), { type: "any" });
  assert.equal(
    createProviderAdapterRegistry().resolve({ adapterId: "anthropic-messages" }).id,
    "anthropic-messages",
  );
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
  const tool = structuredTool(async () => "", {
    name: "read_file",
    description: "Read a file",
    schema: z.object({ filePath: z.string() }),
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
  assert.deepEqual(
    convertMessages([
      { role: "assistant", content: response.content, tool_calls: response.tool_calls },
      { role: "tool", tool_call_id: "tool_1", content: "ok" },
    ]),
    [
      { role: "assistant", content: [thinking, toolUse] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }],
      },
    ],
  );
});

test("Anthropic Messages adapter sends native endpoint and exposes cache usage", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 500,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const client = anthropicMessagesAdapter.createClient({
      credential: "sk-test",
      modelSpec: {
        model: "claude-fable-5-1",
        base_url: `https://api.anthropic.com${"/".repeat(32)}`,
        reasoning_effort: "none",
        reasoning_effort_options: ["none", "low", "medium", "high"],
        reasoning_effort_parameter: "reasoning_effort",
        prompt_cache_fields: ["cache_control"],
        sampling_fields: ["temperature"],
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
    assert.deepEqual(request.body.cache_control, { type: "ephemeral" });
    assert.deepEqual(Object.keys(request.body), [
      "model",
      "stream",
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
    return new Response(
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200 },
    );
  };
  try {
    const tool = structuredTool(async () => "", {
      name: "read_file",
      description: "Read a file",
      schema: z.object({ filePath: z.string() }),
    });
    const client = anthropicMessagesAdapter.createClient({
      credential: "sk-test",
      modelSpec: {
        model: "claude-opus-5",
        base_url: "https://api.anthropic.com",
        reasoning_effort: "medium",
        reasoning_effort_options: ["low", "medium", "high"],
        reasoning_effort_parameter: "reasoning_effort",
        prompt_cache_fields: ["cache_control"],
      },
    });
    await anthropicMessagesAdapter
      .bindTools({
        client,
        tools: [tool],
        toolOptions: { tool_choice: "auto" },
      })
      .invoke([
        { role: "system", content: "rules" },
        { role: "user", content: "hello" },
      ]);

    assert.deepEqual(Object.keys(request.body), [
      "model",
      "stream",
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

const anthropicOperationSpec = Object.freeze({
  model: "claude-opus-5",
  base_url: "https://api.anthropic.com",
  reasoning_effort: "none",
  reasoning_effort_options: ["none", "low", "medium", "high"],
  reasoning_effort_parameter: "reasoning_effort",
});

test("Anthropic multimodal parse maps image attachments to base64 image blocks", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ content: [{ type: "text", text: "parsed" }] }), {
      status: 200,
    });
  };
  try {
    const result = await anthropicMessagesAdapter.executeOperation({
      credential: "sk-test",
      modelSpec: anthropicOperationSpec,
      operation: {
        kind: "multimodal_parse",
        input: {
          prompt: "describe",
          attachments: [
            { mimeType: "image/png", data: "data:image/png;base64,AAAB", fileName: "a.png" },
          ],
        },
      },
    });
    assert.equal(request.url, "https://api.anthropic.com/v1/messages");
    assert.equal(request.body.messages[0].content[0].text, "describe");
    assert.deepEqual(request.body.messages[0].content[1], {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAB" },
    });
    assert.equal(result.rawText, "parsed");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Anthropic multimodal parse maps pdf attachments to document blocks", () => {
  assert.deepEqual(
    mapAnthropicMultimodalAttachment({
      mimeType: "application/pdf",
      data: "data:application/pdf;base64,JVBER",
    }),
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBER" },
    },
  );
});

test("Anthropic multimodal parse rejects unsupported attachment mime types", () => {
  assert.throws(
    () =>
      mapAnthropicMultimodalAttachment({ mimeType: "audio/mp3", data: "data:audio/mp3;base64,QQ" }),
    /does not support attachment mime type: audio\/mp3/,
  );
});

test("Anthropic web search continues the turn when the server tool reports pause_turn", async () => {
  const previousFetch = globalThis.fetch;
  const bodies = [];
  const stopReasons = ["pause_turn", "end_turn"];
  globalThis.fetch = async (_url, init) => {
    const attempt = bodies.length;
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        stop_reason: stopReasons[attempt],
        content:
          attempt === 0
            ? [
                {
                  type: "server_tool_use",
                  id: "srv_1",
                  name: "web_search",
                  input: { query: "noobot" },
                },
                {
                  type: "web_search_tool_result",
                  tool_use_id: "srv_1",
                  content: [
                    { type: "web_search_result", title: "Noobot", url: "https://example.test/a" },
                    {
                      type: "web_search_result",
                      title: "Noobot dup",
                      url: "https://example.test/a",
                    },
                  ],
                },
                { type: "text", text: "partial " },
              ]
            : [{ type: "text", text: "final" }],
      }),
      { status: 200 },
    );
  };
  try {
    const result = await anthropicMessagesAdapter.executeOperation({
      credential: "sk-test",
      modelSpec: anthropicOperationSpec,
      operation: { kind: "web_search", input: { query: "noobot" } },
    });
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0].tools, [{ type: "web_search_20250305", name: "web_search" }]);
    assert.equal(bodies[0].messages[0].content[0].text, "noobot");
    assert.match(bodies[0].system, /Search the web before answering/);
    assert.deepEqual(bodies[0].tool_choice, { type: "any" });
    assert.equal(bodies[1].tool_choice, undefined);
    assert.equal(bodies[1].messages.length, 2);
    assert.equal(bodies[1].messages[1].role, "assistant");
    assert.deepEqual(result, {
      rawText: "partial final",
      sources: [{ title: "Noobot", url: "https://example.test/a" }],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Anthropic adapter rejects operation kinds it cannot serve", async () => {
  await assert.rejects(
    () =>
      anthropicMessagesAdapter.executeOperation({
        credential: "sk-test",
        modelSpec: anthropicOperationSpec,
        operation: { kind: "image_generation", input: { prompt: "cat" } },
      }),
    /does not support operation: image_generation/,
  );
});

test("prompt_cache_ttl reaches the wire through the selected cache field", () => {
  const claude = {
    operatorId: "anthropic",
    model: "claude-sonnet-5",
    modelFamily: "claude",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["low", "medium", "high"],
    prompt_cache_fields: ["cache_control"],
  };
  assert.deepEqual(
    compileProviderModelKwargs({ ...claude, prompt_cache_ttl: "1h" }).cache_control,
    { type: "ephemeral", ttl: "1h" },
  );
  assert.throws(
    () => compileProviderModelKwargs({ ...claude, prompt_cache_ttl: "24h" }),
    /prompt_cache_ttl value 24h is not supported/,
  );
  assert.deepEqual(
    compileProviderModelKwargs({
      operatorId: "kimi",
      model: "kimi-k3",
      modelFamily: "kimi",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["low", "medium", "high"],
      prompt_cache_fields: ["prompt_cache_options"],
      prompt_cache_ttl: "1h",
    }).prompt_cache_options,
    { mode: "implicit", ttl: "1h" },
  );
});

test("Anthropic Messages adapter sends the configured 1h cache_control ttl", async () => {
  const previousFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: "msg_ttl",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
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
        prompt_cache_fields: ["cache_control"],
        prompt_cache_ttl: "1h",
      },
    });
    await client.invoke([{ role: "user", content: "hello" }]);
    assert.deepEqual(body.cache_control, { type: "ephemeral", ttl: "1h" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
