/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { testModelAccess } from "../src/diagnostics/model-access.js";

const modelSpec = {
  model: "gpt-6-astra",
  base_url: "https://example.test/v1",
  api_key: "private-test-credential",
  useResponsesApi: true,
  reasoning_effort_parameter: "reasoning_effort",
  reasoning_effort_options: ["none", "low", "high"],
};

const diagnosticTool = {
  type: "function",
  function: {
    name: "diagnostic_echo",
    description: "Echo text",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
};

for (const protocol of ["responses", "chat", "messages"]) {
  test(`${protocol} binds tools via the existing adapter and leaves unbound requests tool-free`, async () => {
    const spec = {
      ...modelSpec,
      useResponsesApi: protocol === "responses",
      model: protocol === "messages" ? "claude-opus-5" : modelSpec.model,
    };
    for (const choice of ["auto", "required", "none"]) {
      const result = await testModelAccess({
        modelSpec: spec,
        tools: [diagnosticTool],
        toolBinding: { tool_choice: choice },
        signal: new AbortController().signal,
        preview: true,
        fetch: () => assert.fail("preview must not access upstream"),
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      const body = result.traces[0].request.body;
      assert.equal(body.tools.length, 1);
      assert.equal(body.tools[0].function?.name || body.tools[0].name, "diagnostic_echo");
      assert.deepEqual(
        body.tool_choice,
        protocol === "messages" ? { type: choice === "required" ? "any" : choice } : choice,
      );
      assert.equal(Object.hasOwn(body, "signal"), false);
      assert.equal(Object.hasOwn(body, "callbacks"), false);
      const replay = await testModelAccess({
        modelSpec: spec,
        body,
        fetch: async (url, options) => {
          assert.deepEqual(JSON.parse(options.body), body);
          return Response.json(responseFor(protocol));
        },
      });
      assert.equal(replay.ok, true, JSON.stringify(replay.error));
    }
    const unbound = await testModelAccess({ modelSpec: spec, tools: [], preview: true });
    assert.equal(unbound.ok, true);
    for (const field of ["tools", "tool_choice", "parallel_tool_calls"]) {
      assert.equal(Object.hasOwn(unbound.traces[0].request.body, field), false);
    }
  });
}

test("bound tool-call output is returned without executing the requested tool", async () => {
  const result = await testModelAccess({
    modelSpec: { ...modelSpec, useResponsesApi: false },
    tools: [diagnosticTool],
    toolBinding: { tool_choice: "required" },
    fetch: async () =>
      Response.json({
        ...responseFor("chat"),
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_test",
                  type: "function",
                  function: { name: "diagnostic_echo", arguments: '{"text":"OK"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.output.toolCalls[0].name, "diagnostic_echo");
  assert.deepEqual(result.output.toolCalls[0].args, { text: "OK" });
});

function responseFor(protocol) {
  if (protocol === "messages")
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 1 },
    };
  if (protocol === "chat")
    return {
      id: "chat_test",
      object: "chat.completion",
      model: "gpt-6-astra",
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    };
  return {
    id: "resp_test",
    object: "response",
    model: "gpt-6-astra",
    status: "completed",
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "OK", annotations: [] }],
      },
    ],
    usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
  };
}

for (const protocol of ["responses", "chat", "messages"]) {
  test(`diagnostic uses the real ${protocol} adapter and sends precisely the edited body`, async () => {
    const spec = { ...modelSpec, useResponsesApi: protocol === "responses" };
    if (protocol === "messages") spec.model = "claude-opus-5";
    const minimalBody = {
      model: spec.model,
      [protocol === "responses" ? "input" : "messages"]: [{ role: "user", content: "OK?" }],
    };
    let calls = 0;
    const result = await testModelAccess({
      modelSpec: spec,
      body: minimalBody,
      fetch: async (url, options) => {
        calls += 1;
        assert.equal(
          String(url).endsWith(protocol === "chat" ? "/chat/completions" : `/${protocol}`),
          true,
        );
        assert.deepEqual(JSON.parse(options.body), minimalBody);
        assert.equal(
          new Headers(options.headers).get(protocol === "messages" ? "x-api-key" : "authorization"),
          protocol === "messages" ? spec.api_key : `Bearer ${spec.api_key}`,
        );
        return Response.json(responseFor(protocol));
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(calls, 1);
    assert.equal(result.output.text, "OK");
    assert.equal(result.traces[0].response.status, 200);
    assert.equal(JSON.stringify(result).includes(spec.api_key), false);
    assert.equal(
      JSON.parse(result.traces[0].response.body).usage[
        protocol === "chat" ? "total_tokens" : "input_tokens"
      ],
      protocol === "chat" ? 5 : 4,
    );
  });
}

test("preview captures SDK defaults without any network request", async () => {
  const result = await testModelAccess({
    modelSpec: { ...modelSpec, sampling_fields: ["temperature"] },
    preview: true,
    fetch: () => assert.fail("preview accessed upstream"),
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0].request.body.temperature, 0.7);
  assert.equal(result.traces[0].request.body.model, modelSpec.model);
  assert.equal(result.traces[0].response, undefined);
});

test("preview omits sampling parameters that are not selected", async () => {
  const result = await testModelAccess({
    modelSpec: { ...modelSpec, temperature: 0.4, sampling_fields: [] },
    preview: true,
    fetch: () => assert.fail("preview accessed upstream"),
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const body = result.traces[0].request.body;
  for (const key of ["temperature", "top_p", "top_k", "min_p", "sampling_fields"]) {
    assert.equal(key in body, false, key);
  }
});

test("upstream failure keeps status and raw body without retries or credential leaks", async () => {
  let calls = 0;
  const result = await testModelAccess({
    modelSpec,
    fetch: async () => {
      calls += 1;
      return Response.json(
        { error: { message: `Upstream request failed ${modelSpec.api_key}` } },
        { status: 429 },
      );
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(result.traces[0].response.status, 429);
  assert.match(result.traces[0].response.body, /Upstream request failed/);
  assert.equal(JSON.stringify(result).includes(modelSpec.api_key), false);
});

test("cancellation reaches the adapter transport", async () => {
  const controller = new AbortController();
  const result = await testModelAccess({
    modelSpec,
    signal: controller.signal,
    fetch: async (url, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort();
      options.signal.throwIfAborted();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.traces.length, 1);
});

test("streaming chat response retains raw SSE and normalized model output", async () => {
  const chunks = [
    {
      id: "chat_stream",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }],
    },
    {
      id: "chat_stream",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  const result = await testModelAccess({
    modelSpec: { ...modelSpec, useResponsesApi: false },
    body: { model: modelSpec.model, messages: [{ role: "user", content: "OK?" }], stream: true },
    fetch: async () =>
      new Response(
        `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.output.text, "OK");
  assert.match(result.traces[0].response.body, /data: \[DONE\]/);
});
