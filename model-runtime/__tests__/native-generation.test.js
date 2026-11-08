/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModelOperation, resolveModelLibraryProvider } from "@noobot/model-protocol";
import { executeNativeGeneration } from "../src/adapters/native-generation.js";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation } from "./runtime-fixtures.js";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TEST_API_ADDRESSES = {
  OPENAI_API_ADDRESS: "https://api.openai.com/v1",
  XAI_API_ADDRESS: "https://api.x.ai/v1",
  GEMINI_NATIVE_API_ADDRESS: "https://generativelanguage.googleapis.com/v1beta",
  DASHSCOPE_NATIVE_API_ADDRESS: "https://dashscope.aliyuncs.com/api/v1",
  MINIMAX_VIDEO_API_ADDRESS: "https://api.minimax.io/v2",
};

function resolvedTestProvider(alias) {
  const provider = resolveModelLibraryProvider(alias);
  const key = provider.base_url.slice(2, -1);
  assert.ok(TEST_API_ADDRESSES[key], `unregistered address parameter: ${key}`);
  return { ...provider, base_url: TEST_API_ADDRESSES[key] };
}

function setup(alias, outputType = "image", options = {}, responses = []) {
  const calls = [];
  const input = {
    modelSpec: resolvedTestProvider(alias),
    credential: "private-key",
    streaming: false,
    signal: new AbortController().signal,
    clock: { sleep: async () => {} },
    operation: normalizeModelOperation({
      kind: "media_generation",
      input: { prompt: "a red bird", outputType },
      options,
    }),
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...init });
      assert.ok(responses.length, `unexpected request: ${url}`);
      const response = responses.shift();
      return response instanceof Response ? response : json(response);
    },
  };
  return { input, calls, run: () => executeNativeGeneration(input) };
}

const image = { data: [{ b64_json: "AQ==" }] };
const doneVideo = { status: "done", video: { url: "https://cdn.example.test/result.mp4" } };

test("OpenAI native Images sends model parameters directly without tools", async () => {
  const ctx = setup(
    "gpt_image_2_6_sunburst",
    "image",
    { size: "1024x1024", complexity: "high", n: 2 },
    [image],
  );
  const result = await ctx.run();
  assert.equal(ctx.calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.deepEqual(JSON.parse(ctx.calls[0].body), {
    model: "gpt-image-2.6-sunburst",
    prompt: "a red bird",
    n: 2,
    output_format: "png",
    size: "1024x1024",
    complexity: "high",
  });
  assert.equal(result.artifacts[0].mimeType, "image/png");
  assert.equal(result.artifacts[0].contentBase64, "AQ==");
});

test("OpenAI editing uploads multipart source bytes without sending credentials to image hosts", async () => {
  const ctx = setup(
    "gpt_image_2_6_flare",
    "image",
    { imageUrls: ["https://cdn.example.test/source.png"] },
    [new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }), image],
  );
  await ctx.run();
  assert.equal(ctx.calls[0].headers, undefined);
  assert.match(ctx.calls[1].url, /images\/edits$/);
  assert.ok(ctx.calls[1].body instanceof FormData);
  assert.equal(ctx.calls[1].body.get("image[]").size, 1);
  assert.equal(ctx.calls[1].body.get("output_format"), "png");
});

test("xAI native image generation preserves JPEG media type and image edit input", async () => {
  const ctx = setup(
    "grok_imagine_image_2_0",
    "image",
    { size: "16:9", imageUrls: ["https://cdn.example.test/source.jpg"] },
    [image],
  );
  const result = await ctx.run();
  assert.match(ctx.calls[0].url, /images\/edits$/);
  const body = JSON.parse(ctx.calls[0].body);
  assert.equal(body.aspect_ratio, "16:9");
  assert.deepEqual(body.image, { url: "https://cdn.example.test/source.jpg" });
  assert.equal(result.artifacts[0].mimeType, "image/jpeg");
  assert.match(result.artifacts[0].fileName, /\.jpg$/);
});

test("DashScope native image generation maps multimodal content and size", async () => {
  const ctx = setup("qwen_image_3_0_pro", "image", { size: "1024x1024" }, [
    {
      output: {
        choices: [{ message: { content: [{ image: "https://cdn.example.test/q.png" }] } }],
      },
    },
  ]);
  const result = await ctx.run();
  const body = JSON.parse(ctx.calls[0].body);
  assert.deepEqual(body.input.messages[0].content, [{ text: "a red bird" }]);
  assert.equal(body.parameters.size, "1024*1024");
  assert.match(ctx.calls[0].url, /services\/aigc\/multimodal-generation\/generation$/);
  assert.equal(result.artifacts[0].url, "https://cdn.example.test/q.png");
});

test("Gemini generateContent returns only non-thought native images", async () => {
  const ctx = setup("gemini_3_pro_image", "image", { size: "1:1", resolution: "2K" }, [
    {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, inlineData: { mimeType: "image/png", data: "AA==" } },
              { text: "done" },
              { inlineData: { mimeType: "image/png", data: "AQ==" } },
            ],
          },
        },
      ],
    },
  ]);
  const result = await ctx.run();
  assert.match(ctx.calls[0].url, /v1beta\/models\/gemini-3-pro-image:generateContent$/);
  assert.equal(ctx.calls[0].headers["x-goog-api-key"], "private-key");
  assert.equal(ctx.calls[0].headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(ctx.calls[0].body).generationConfig.imageConfig, {
    aspectRatio: "1:1",
    imageSize: "2K",
  });
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].contentBase64, "AQ==");
  assert.equal(result.rawText, "done");
});

test("Gemini Interactions separates native model output from user content", async () => {
  const ctx = setup("gemini_nano_banana_2_1", "image", {}, [
    {
      id: "i1",
      status: "completed",
      steps: [
        { type: "user_input", content: [{ type: "image", mime_type: "image/png", data: "AA==" }] },
        {
          type: "model_output",
          content: [{ type: "image", mime_type: "image/png", data: "AQ==" }],
        },
      ],
    },
  ]);
  const result = await ctx.run();
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].contentBase64, "AQ==");
  assert.deepEqual(JSON.parse(ctx.calls[0].body).response_format, {
    type: "image",
    mime_type: "image/png",
  });
  assert.equal(ctx.calls[0].headers["Api-Revision"], "2026-05-20");
});

test("Gemini Omni polls background Interactions for a native video result", async () => {
  const ctx = setup(
    "gemini_omni_1_2_flash",
    "video",
    { duration: 5, aspectRatio: "16:9", resolution: "720p" },
    [
      { id: "v1", status: "in_progress" },
      {
        id: "v1",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              { type: "video", mime_type: "video/mp4", uri: "https://cdn.example.test/omni.mp4" },
            ],
          },
        ],
      },
    ],
  );
  const result = await ctx.run();
  const body = JSON.parse(ctx.calls[0].body);
  assert.equal(body.background, true);
  assert.deepEqual(body.response_format, {
    type: "video",
    aspect_ratio: "16:9",
    resolution: "720p",
    duration: "5s",
  });
  assert.match(ctx.calls[1].url, /interactions\/v1$/);
  assert.equal(result.taskId, "v1");
});

test("xAI native video creates once, polls status, and maps reference images", async () => {
  const ctx = setup(
    "grok_imagine_video_1_5",
    "video",
    {
      duration: 5,
      imageUrls: ["https://cdn.example.test/a.jpg", "https://cdn.example.test/b.jpg"],
    },
    [{ request_id: "task" }, { status: "pending" }, doneVideo],
  );
  const result = await ctx.run();
  assert.match(ctx.calls[0].url, /v1\/videos\/generations$/);
  assert.deepEqual(JSON.parse(ctx.calls[0].body).reference_images, [
    { url: "https://cdn.example.test/a.jpg" },
    { url: "https://cdn.example.test/b.jpg" },
  ]);
  assert.deepEqual(
    ctx.calls.map((call) => call.method),
    ["POST", "GET", "GET"],
  );
  assert.equal(result.taskId, "task");
  assert.equal(result.artifacts[0].mimeType, "video/mp4");
});

test("DashScope video uses the unified native media input for every declared mode", async () => {
  for (const [alias, imageUrls, mediaType] of [
    ["wan3_0_video", [], undefined],
    ["wan3_0_video_prime", ["https://cdn.example.test/a.jpg"], "first_frame"],
    ["happyhorse_1_1_t2v", [], undefined],
    ["happyhorse_1_1_i2v", ["https://cdn.example.test/a.jpg"], "first_frame"],
    ["happyhorse_1_1_r2v", ["https://cdn.example.test/a.jpg"], "reference_image"],
  ]) {
    const ctx = setup(alias, "video", { imageUrls, resolution: "720P", duration: 5 }, [
      { output: { task_id: "task", task_status: "PENDING" } },
      { output: { task_status: "SUCCEEDED", video_url: "https://cdn.example.test/wan.mp4" } },
    ]);
    await ctx.run();
    const body = JSON.parse(ctx.calls[0].body);
    assert.deepEqual(
      body.input.media,
      mediaType ? [{ type: mediaType, url: imageUrls[0] }] : undefined,
    );
    assert.equal(ctx.calls[0].headers["X-DashScope-Async"], "enable");
    assert.match(ctx.calls[1].url, /api\/v1\/tasks\/task$/);
  }
});

test("MiniMax H3 uses the v2 creation and status contract with explicit required parameters", async () => {
  const ctx = setup(
    "minimax_h3",
    "video",
    { duration: 5, resolution: "768P", aspectRatio: "16:9" },
    [
      { task_id: "h3" },
      { task: { status: "running" } },
      { task: { status: "succeeded", content: { url: "https://cdn.example.test/h3.mp4" } } },
    ],
  );
  await ctx.run();
  assert.equal(ctx.calls[0].url, "https://api.minimax.io/v2/video_generation");
  assert.deepEqual(JSON.parse(ctx.calls[0].body), {
    model: "MiniMax-H3",
    content: [{ type: "text", text: "a red bird" }],
    duration: 5,
    resolution: "768P",
    ratio: "16:9",
  });
  assert.match(ctx.calls[1].url, /v2\/query\/video_generation\/h3$/);
  const missing = setup("minimax_h3", "video");
  await assert.rejects(missing.run(), /requires resolution, duration/);
  assert.equal(missing.calls.length, 0);
});

test("native generation rejects incompatible options and model input modes before submission", async () => {
  for (const [alias, type, options, pattern] of [
    ["gemini_3_pro_image", "image", { n: 2 }, /does not support option: n/],
    ["gpt_image_2_6_flare", "image", { size: "16:9" }, /explicit pixel size/],
    ["happyhorse_1_1_i2v", "video", {}, /requires one source image/],
    [
      "happyhorse_1_1_t2v",
      "video",
      { imageUrls: ["https://cdn.example.test/a.png"] },
      /does not accept/,
    ],
  ]) {
    const ctx = setup(alias, type, options);
    await assert.rejects(ctx.run(), pattern);
    assert.equal(ctx.calls.length, 0);
  }
});

test("native generation reports HTTP errors, empty results and unknown or failed task states", async () => {
  for (const [alias, type, responses, pattern] of [
    [
      "gpt_image_2_6_flare",
      "image",
      [new Response("quota exceeded", { status: 429 })],
      /HTTP 429: quota exceeded/,
    ],
    ["gpt_image_2_6_flare", "image", [{ data: [] }], /returned no media/],
    [
      "qwen_image_3_0_pro",
      "image",
      [{ code: "Denied", message: "no access" }],
      /Denied: no access/,
    ],
    [
      "grok_imagine_video_1_5",
      "video",
      [{ request_id: "t" }, { status: "failed" }],
      /generation task failed/,
    ],
    [
      "grok_imagine_video_1_5",
      "video",
      [{ request_id: "t" }, { status: "unexpected" }],
      /unknown generation task status/,
    ],
  ]) {
    const ctx = setup(alias, type, {}, responses);
    await assert.rejects(ctx.run(), pattern);
  }
});

test("aborting a pending video stops polling and retains task identity", async () => {
  const ctx = setup("grok_imagine_video_1_5", "video", {}, [
    { request_id: "task" },
    { status: "pending" },
  ]);
  const controller = new AbortController();
  ctx.input.signal = controller.signal;
  ctx.input.clock = {
    sleep: async () => {
      controller.abort(new Error("user cancelled"));
    },
  };
  await assert.rejects(ctx.run(), (error) => {
    assert.match(error.message, /user cancelled/);
    assert.equal(error.taskId, "task");
    return true;
  });
  assert.equal(ctx.calls.length, 2);
});

test("executor dispatches generation independently of the conversation adapter and preserves cancellation", async () => {
  for (const adapterId of ["openai-compatible", "anthropic-messages"]) {
    const signal = new AbortController().signal;
    const calls = [];
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "private-key" },
      providerRuntime: {
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), ...init });
          assert.equal(init.signal, signal);
          return json(image);
        },
      },
    });
    const result = await executor.invoke({
      model: {
        ...resolvedTestProvider("gpt_image_2_6_flare"),
        operatorId: "openai",
        adapterId,
      },
      invocation,
      messages: [],
      options: { signal },
      operation: { kind: "media_generation", input: { prompt: "bird", outputType: "image" } },
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /images\/generations$/);
    assert.equal(result.result.artifacts[0].contentBase64, "AQ==");
  }
});

test("executor never resubmits a billable native generation after a transport failure", async () => {
  let submissions = 0;
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "private-key" },
    providerRuntime: {
      fetchImpl: async () => {
        submissions++;
        return json({ error: { message: "busy" } }, 503);
      },
    },
    clock: { sleep: async () => {} },
  });
  await assert.rejects(
    executor.invoke({
      model: {
        ...resolvedTestProvider("grok_imagine_video_1_5"),
        operatorId: "xai",
        adapterId: "openai-compatible",
      },
      invocation,
      messages: [],
      options: { signal: new AbortController().signal },
      operation: { kind: "media_generation", input: { prompt: "bird", outputType: "video" } },
    }),
    /503/,
  );
  assert.equal(submissions, 1);
});
