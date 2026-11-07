/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

import { createMultimodalGenerateTool } from "../../src/tools/ai-models/multimodal-generate-tool.js";
import { createTestModelHost } from "../helpers/test-model-host.js";

const IMAGE_PROVIDER_BASE_URL = "https://image-provider.example.test";

function textResponse(body, status) {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

async function rejectUnexpectedFetch() {
  throw new Error("multimodal_generate must not fetch when modelPort is injected");
}

function withExecutorModelHost(runtime) {
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: ({ modelSpec }) => modelSpec.api_key },
    providerRuntime: {
      fetchImpl: runtime.sharedTools.fetch,
    },
    clock: { sleep: async () => {} },
  });
  const modelPort = {
    invoke(request) {
      return executor.invoke({
        ...request,
        invocation: {
          requestId: "multimodal-test-request",
          invocationId: "multimodal-test-invocation",
          sessionId: "multimodal-test-session",
          parentSessionId: "",
          dialogProcessId: "multimodal-test-process",
          turnScopeId: "multimodal-test-turn",
          runId: "multimodal-test-run",
          flow: request.invocation.flow,
          purpose: request.invocation.purpose,
          domain: request.invocation.domain,
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
      });
    },
  };
  runtime.modelHost = createTestModelHost({ modelPort, modelSpec: null });
  return runtime;
}

function getMultimodalGenerateTool(runtime) {
  const tools = createMultimodalGenerateTool({
    agentContext: { bindings: { tools: [{ name: "multimodal_generate" }], runtime } },
  });
  const tool = tools.find((item) => item?.name === "multimodal_generate");
  assert.ok(tool, "multimodal_generate tool should exist");
  return tool;
}

test("multimodal_generate: failed image generation returns diagnostics and stable error code", async () => {
  const originalHttpsProxy = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = "http://user:secret@127.0.0.1:7890";
  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://models.example.com/v1?token=secret",
          model: "gpt-image-2",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_images",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch() {
        return textResponse("WebSocket upgrade required (Upgrade: websocket)", 426);
      },
    },
  };
  const tool = getMultimodalGenerateTool(withExecutorModelHost(runtime));

  try {
    await assert.rejects(
      tool.invoke({
        generation_content: "draw a small red square",
        model_name: "gpt_image_2",
      }),
      (error) => {
        assert.equal(error?.code, "RECOVERABLE_MULTIMODAL_GENERATE_FAILED");
        assert.match(error?.message || "", /WebSocket upgrade required/);
        assert.equal(error?.details?.modelAlias, "gpt_image_2");
        assert.equal(error?.details?.model, "gpt-image-2");
        assert.equal(error?.details?.callMode, "multimodal_generation");
        assert.equal(error?.details?.apiType, undefined);
        assert.equal(error?.details?.baseUrl, "https://models.example.com/v1");
        assert.equal(error?.details?.availableApiTypes, undefined);
        assert.equal(error?.details?.proxyEnv?.HTTPS_PROXY, "http://***:***@127.0.0.1:7890/");
        assert.equal(JSON.stringify(error?.details?.proxyEnv || {}).includes("secret"), false);
        return true;
      },
    );
  } finally {
    if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = originalHttpsProxy;
  }
});

test("multimodal_generate: model configuration is the only image API type authority", async () => {
  let modelRequest = null;
  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://models.example.com/v1",
          model: "gpt-image-2",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_images",
            },
          },
        },
      },
    },
    userConfig: {},
    modelHost: createTestModelHost({
      modelPort: {
        async invoke(request) {
          modelRequest = request;
          return {
            result: {
              rawText: "",
              artifacts: [
                { fileName: "generated.png", mimeType: "image/png", contentBase64: "AA==" },
              ],
            },
          };
        },
      },
      modelSpec: null,
    }),
    sharedTools: { fetch: rejectUnexpectedFetch },
  };
  const tool = getMultimodalGenerateTool(runtime);

  assert.equal(
    tool.schema.options.every((option) => !("api_type" in option.shape)),
    true,
  );
  assert.equal(tool.schema.parse({ generation_content: "draw" }).output_type, "image");
  const video = {
    generation_content: "fly",
    output_type: "video",
    duration: 5,
    aspect_ratio: "16:9",
    resolution: "720p",
  };
  assert.deepEqual(tool.schema.parse(video), video);
  for (const option of [
    { n: 2 },
    { quality: "high" },
    { complexity: "low" },
    { size: "1024x1024" },
  ]) {
    assert.equal(tool.schema.safeParse({ ...video, ...option }).success, false);
  }
  const result = JSON.parse(
    await tool.invoke({
      generation_content: "draw a bird",
      model_name: "gpt_image_2",
      size: "1:1",
    }),
  );
  assert.equal(result.ok, true);
  assert.equal("apiType" in modelRequest.operation.options, false);
  assert.equal(
    modelRequest.model.multimodal_generation.support_generation.api_type,
    "openai_images",
  );
});

test("multimodal_generate: an unknown requested model is rejected before capability resolution", async () => {
  const runtime = {
    globalConfig: {
      providers: {
        configured_image: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://models.example.com/v1",
          model: "configured-image",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_images",
            },
          },
        },
      },
    },
    userConfig: {},
    modelHost: createTestModelHost({
      modelPort: { invoke: async () => ({ result: {} }) },
      modelSpec: null,
    }),
    sharedTools: { fetch: rejectUnexpectedFetch },
  };
  const tool = getMultimodalGenerateTool(runtime);

  await assert.rejects(
    tool.invoke({
      generation_content: "draw a test image",
      model_name: "gpt-image-1",
    }),
    (error) => {
      assert.equal(error?.code, "RECOVERABLE_MODEL_NOT_FOUND");
      assert.match(error?.message || "", /gpt-image-1/);
      assert.equal(error?.details?.requestedModel, "gpt-image-1");
      return true;
    },
  );
});

test("multimodal_generate: canonical provider merge preserves Windows default image capability", async () => {
  let modelRequest = null;
  const modelAlias = ["gpt", "5", "6", "sol"].join("_");
  const runtime = {
    globalConfig: {
      multimodal: { generation: { default_models: { image: modelAlias } } },
      providers: {
        [modelAlias]: {
          enabled: true,
          used_for_conversation: true,
          api_key: "test-key",
          base_url: `${IMAGE_PROVIDER_BASE_URL}/chatgpt/v1`,
          model: "gpt-5.6-sol",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_images",
            },
          },
        },
      },
    },
    userConfig: {
      providers: {
        [modelAlias]: {
          multimodal_generation: {
            support_generation: { api_type: "openai_images" },
          },
        },
      },
    },
    modelHost: createTestModelHost({
      modelPort: {
        async invoke(request) {
          modelRequest = request;
          return {
            result: {
              rawText: "",
              artifacts: [
                { fileName: "generated.png", mimeType: "image/png", contentBase64: "AA==" },
              ],
            },
          };
        },
      },
      modelSpec: null,
    }),
    sharedTools: { fetch: rejectUnexpectedFetch },
  };
  const tool = getMultimodalGenerateTool(runtime);

  const result = JSON.parse(
    await tool.invoke({
      generation_content:
        "A minimal flat blue square icon with a white check mark, no text, for a tool connectivity test.",
      image_urls: [],
      model_name: "",
      n: 1,
      quality: "standard",
      resolution: "1K",
      size: "1:1",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(modelRequest.model.alias, modelAlias);
  assert.equal("apiType" in modelRequest.operation.options, false);
  assert.equal(
    modelRequest.model.multimodal_generation.support_generation.api_type,
    "openai_images",
  );
});

test("multimodal_generate: Native generation completion without an image artifact is a failure", async () => {
  const runtime = {
    globalConfig: {
      providers: {
        image_model: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://models.example.com/v1",
          model: "image-model",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_images",
            },
          },
        },
      },
    },
    userConfig: {},
    modelHost: createTestModelHost({
      modelPort: {
        async invoke() {
          return { result: { rawText: "prompt only", artifacts: [] } };
        },
      },
      modelSpec: null,
    }),
    sharedTools: { fetch: rejectUnexpectedFetch },
  };
  const tool = getMultimodalGenerateTool(runtime);
  await assert.rejects(
    tool.invoke({ generation_content: "draw a bird", model_name: "image_model" }),
    (error) => error?.code === "RECOVERABLE_MULTIMODAL_GENERATE_FAILED",
  );
});

test("multimodal_generate: native video uses the configured video model and returns an attachment", async () => {
  const calls = [];
  const runtime = {
    globalConfig: {
      multimodal: { generation: { default_models: { video: "video_model" } } },
      providers: {
        video_model: {
          enabled: true,
          used_for_conversation: false,
          model: "grok-imagine-video-1.5",
          api_key: "private",
          base_url: "https://video.example.test/v1",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none"],
          multimodal_generation: {
            support_generation: { enabled: true, support_scope: ["video"], api_type: "xai_video" },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      fetch: async (url, init) => {
        calls.push({ url: String(url), ...init });
        if (String(url).endsWith("videos/generations")) return Response.json({ request_id: "v1" });
        if (String(url).endsWith("videos/v1"))
          return Response.json({
            status: "done",
            video: { url: "https://cdn.example.test/a.mp4" },
          });
        return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "video/mp4" } });
      },
    },
  };
  const tool = getMultimodalGenerateTool(withExecutorModelHost(runtime));
  const result = JSON.parse(
    await tool.invoke({ generation_content: "a bird flies", output_type: "video", duration: 5 }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.generated_video_count, 1);
  assert.equal(result.summary.task_id, "v1");
  assert.equal(result.outputArtifacts[0].mimeType, "video/mp4");
  assert.equal(result.outputArtifacts[0].contentBase64, "AQI=");
  assert.equal(calls[2].headers, undefined);
  assert.equal(JSON.parse(calls[0].body).tools, undefined);
});

test("generated attachments reject a declared MIME mismatch and stop on cancellation", async () => {
  const { materializeGenerationAttachments } =
    await import("../../src/tools/ai-models/generation-artifacts.js");
  const artifacts = [
    { fileName: "a.mp4", mimeType: "video/mp4", url: "https://cdn.example.test/a.mp4" },
  ];
  await assert.rejects(
    materializeGenerationAttachments(artifacts, {
      modality: "video",
      abortSignal: new AbortController().signal,
      fetchImpl: async () =>
        new Response("error page", { headers: { "content-type": "text/html" } }),
    }),
    /MIME mismatch/,
  );
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    materializeGenerationAttachments(artifacts, {
      modality: "video",
      abortSignal: controller.signal,
      fetchImpl: async () => assert.fail("cancelled generation must not download"),
    }),
    /cancelled/,
  );
});
