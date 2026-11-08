/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_REQUEST_EVENT, resolveModelLibraryProvider } from "@noobot/model-protocol";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation } from "./runtime-fixtures.js";

for (const responses of [false, true]) {
  test(`real OpenAI SDK ${responses ? "Responses" : "Completions"} transport preserves zero output usage`, async () => {
    const events = [];
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "test" },
      observationPort: { emit: (type, data) => events.push({ type, data }) },
      providerRuntime: {
        fetchImpl: async (url, init) => {
          assert.equal(init.method, "POST");
          assert.ok(String(url).endsWith(responses ? "/responses" : "/chat/completions"));
          return Response.json(
            responses
              ? {
                  id: "resp_test",
                  object: "response",
                  status: "completed",
                  model: "test",
                  output: [
                    {
                      id: "msg_test",
                      type: "message",
                      status: "completed",
                      role: "assistant",
                      content: [{ type: "output_text", text: "done", annotations: [] }],
                    },
                  ],
                  usage: {
                    input_tokens: 10,
                    output_tokens: 0,
                    total_tokens: 10,
                    input_tokens_details: { cached_tokens: 0 },
                  },
                }
              : {
                  id: "chat_test",
                  object: "chat.completion",
                  model: "test",
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: "done" },
                      finish_reason: "stop",
                    },
                  ],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 0,
                    total_tokens: 10,
                    prompt_tokens_details: { cached_tokens: 0 },
                  },
                },
          );
        },
      },
    });
    const result = await executor.invoke({
      invocation,
      model: {
        model: "test",
        operatorId: "openai",
        adapterId: "openai-compatible",
        base_url: "https://provider.test/v1",
        use_responses_api: responses,
        reasoning_effort: "none",
        reasoning_effort_options: ["none"],
        reasoning_effort_parameter: "reasoning_effort",
      },
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.output.text, "done");
    assert.equal(Object.hasOwn(result.output, "usage"), false);
    const usage = events.filter(({ type }) => type === MODEL_REQUEST_EVENT.USAGE);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].data.measurementError, null);
    assert.deepEqual(usage[0].data.usage.outputTokens, { state: "reported", value: 0 });
    assert.deepEqual(usage[0].data.usage.cacheReadInputTokens, { state: "reported", value: 0 });
  });
}

test("native video polling and source-image downloads never inflate model request counts", async () => {
  const events = [];
  const calls = [];
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "test" },
    observationPort: { emit: (type, data) => events.push({ type, data }) },
    clock: { now: () => 0, sleep: async () => {} },
    providerRuntime: {
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || "GET" });
        if (String(url).endsWith("/images/edits"))
          return Response.json({ data: [{ b64_json: "AQ==" }] });
        if (String(url).endsWith("source.png"))
          return new Response(Uint8Array.of(1), {
            headers: { "content-type": "image/png" },
          });
        if (init.method === "POST") return Response.json({ request_id: "task" });
        return Response.json({ status: "done", video: { url: "https://cdn.test/result.mp4" } });
      },
    },
  });
  const image = resolveModelLibraryProvider("gpt_image_2_6_flare");
  await executor.invoke({
    invocation,
    options: { signal: new AbortController().signal },
    model: {
      ...image,
      base_url: "https://provider.test/v1",
      operatorId: "openai",
      adapterId: "openai-compatible",
    },
    messages: [],
    operation: {
      kind: "media_generation",
      input: { prompt: "bird", outputType: "image" },
      options: { imageUrls: ["https://cdn.test/source.png"] },
    },
  });
  const video = resolveModelLibraryProvider("grok_imagine_video_1_5");
  await executor.invoke({
    invocation,
    options: { signal: new AbortController().signal },
    model: {
      ...video,
      base_url: "https://provider.test/v1",
      operatorId: "xai",
      adapterId: "openai-compatible",
    },
    messages: [],
    operation: { kind: "media_generation", input: { prompt: "bird", outputType: "video" } },
  });
  assert.equal(calls.filter(({ method }) => method === "GET").length, 2);
  assert.equal(events.filter(({ type }) => type === MODEL_REQUEST_EVENT.STARTED).length, 2);
  assert.equal(events.filter(({ type }) => type === MODEL_REQUEST_EVENT.FINISHED).length, 2);
});
