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

function getMultimodalGenerateTool(runtime = {}) {
  if (!runtime.modelPort) {
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: ({ modelSpec }) => modelSpec.api_key },
      providerRuntime: {
        fetchImpl: runtime?.sharedTools?.fetch,
      },
      clock: { sleep: async () => {} },
    });
    runtime.modelPort = {
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
  }
  const tools = createMultimodalGenerateTool({
    agentContext: { bindings: { runtime } },
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
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "images_async",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch() {
        return {
          ok: false,
          status: 426,
          async text() {
            return "WebSocket upgrade required (Upgrade: websocket)";
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

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
        assert.equal(error?.details?.apiType, "images_async");
        assert.equal(error?.details?.callMode, "images_async_api");
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
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_responses",
            },
          },
        },
      },
    },
    userConfig: {},
    modelPort: {
      async invoke(request) {
        modelRequest = request;
        return { result: { rawText: "", imageArtifacts: [], output: [] } };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  assert.equal("api_type" in tool.schema.shape, false);
  const result = JSON.parse(
    await tool.invoke({
      generation_content: "draw a bird",
      model_name: "gpt-image-2",
      size: "1:1",
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(modelRequest.operation.options.apiType, "openai_responses");
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
          base_url: "https://api.aicodewith.com/chatgpt/v1",
          model: "gpt-5.6-sol",
          format: "openai_compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_responses",
            },
          },
        },
      },
    },
    userConfig: {
      providers: {
        [modelAlias]: {
          multimodal_generation: {
            support_generation: { api_type: "openai_responses" },
          },
        },
      },
    },
    modelPort: {
      async invoke(request) {
        modelRequest = request;
        return { result: { rawText: "", imageArtifacts: [], output: [] } };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  const result = JSON.parse(
    await tool.invoke({
      generation_content:
        "A minimal flat blue square icon with a white check mark, no text, for a tool connectivity test.",
      image_size: "512x512",
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
  assert.equal(modelRequest.operation.options.apiType, "openai_responses");
});

test("multimodal_generate: images_async polls task endpoint without websocket handshake", async () => {
  const requestedUrls = [];
  const requestedHeaders = [];
  const port = 12345;

  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: `http://127.0.0.1:${port}/v1`,
          model: "gpt-image-2",
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "images_async",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch(url, init = {}) {
        requestedUrls.push(`${String(init?.method || "GET").toUpperCase()} ${String(url || "")}`);
        requestedHeaders.push({ ...init.headers });
        if (String(url || "").endsWith("/v1/images/generations")) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({ data: [{ task_id: "task-1" }] });
            },
          };
        }
        if (String(url || "").endsWith("/v1/tasks/task-1")) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                status: "completed",
                result_data: [
                  {
                    b64_json: `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`,
                  },
                ],
              });
            },
          };
        }
        return {
          ok: false,
          status: 426,
          async text() {
            return "WebSocket upgrade required (Upgrade: websocket)";
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  const payload = JSON.parse(
    await tool.invoke({
      generation_content: "draw a bird",
      model_name: "gpt-image-2",
      size: "1:1",
    }),
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.callMode, "images_async_api");
  assert.equal(payload.summary.task_id, "task-1");
  assert.equal(payload.summary.generated_image_count, 1);
  assert.deepEqual(requestedUrls, [
    `POST http://127.0.0.1:${port}/v1/images/generations`,
    `GET http://127.0.0.1:${port}/v1/tasks/task-1`,
  ]);
  assert.equal(requestedHeaders.length, 2);
  for (const headers of requestedHeaders) {
    assert.equal(headers.Authorization, "Bearer test-key");
    assert.equal(headers["X-Model-Name"], "gpt-image-2");
    assert.equal(headers["X-Plugin-Flow"], "agent.multimodal_generate");
    assert.equal(headers["X-Plugin-Purpose"], "multimodal_generate");
    assert.equal(headers["X-Plugin-Domain"], "tool");
    assert.equal(headers["X-Plugin-Session-Id"], "multimodal-test-session");
  }
});

test("multimodal_generate: images_async follows official aicodewith root base url example", async () => {
  const requested = [];
  const bodies = [];
  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://api.aicodewith.com",
          model: "gpt-image-2",
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "images_async",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch(url, init = {}) {
        requested.push(`${String(init?.method || "GET").toUpperCase()} ${String(url || "")}`);
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        if (String(url || "") === "https://api.aicodewith.com/v1/images/generations") {
          return {
            ok: true,
            async text() {
              return JSON.stringify({ id: "task-unified-1777017804-vskdh190" });
            },
          };
        }
        if (
          String(url || "") ===
          "https://api.aicodewith.com/v1/tasks/task-unified-1777017804-vskdh190"
        ) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({
                status: "completed",
                progress: 100,
                result_data: [{ url: "https://cdn.example.com/generated-cat.png" }],
              });
            },
          };
        }
        if (String(url || "") === "https://cdn.example.com/generated-cat.png") {
          return {
            ok: true,
            async arrayBuffer() {
              return Buffer.from("fake-generated-cat");
            },
          };
        }
        return {
          ok: false,
          status: 404,
          async text() {
            return "unexpected url";
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  const payload = JSON.parse(
    await tool.invoke({
      generation_content: "一只可爱的猫咪在阳光下打盹",
      model_name: "gpt-image-2",
      size: "1:1",
      resolution: "1K",
      n: 4,
      quality: "low",
      image_urls: ["https://your-image-url.png"],
    }),
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.task_id, "task-unified-1777017804-vskdh190");
  assert.equal(payload.summary.generated_image_count, 1);
  assert.deepEqual(requested, [
    "POST https://api.aicodewith.com/v1/images/generations",
    "GET https://api.aicodewith.com/v1/tasks/task-unified-1777017804-vskdh190",
    "GET https://cdn.example.com/generated-cat.png",
  ]);
  assert.deepEqual(bodies, [
    {
      model: "gpt-image-2",
      prompt: "一只可爱的猫咪在阳光下打盹",
      size: "1:1",
      resolution: "1K",
      n: 4,
      quality: "low",
      image_urls: ["https://your-image-url.png"],
    },
  ]);
});

test("multimodal_generate: images_async normalizes chatgpt base path to official v1 task endpoint", async () => {
  const requestedUrls = [];
  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://api.aicodewith.com/chatgpt/v1",
          model: "gpt-image-2",
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "images_async",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch(url, init = {}) {
        requestedUrls.push(`${String(init?.method || "GET").toUpperCase()} ${String(url || "")}`);
        if (String(url || "") === "https://api.aicodewith.com/v1/images/generations") {
          return {
            ok: true,
            async text() {
              return JSON.stringify({ data: [{ task_id: "task-426" }] });
            },
          };
        }
        return {
          ok: false,
          status: 426,
          async text() {
            return "WebSocket upgrade required (Upgrade: websocket)";
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  await assert.rejects(
    tool.invoke({
      generation_content: "draw a bird",
      model_name: "gpt-image-2",
      size: "1:1",
    }),
    (error) => {
      assert.equal(error?.code, "RECOVERABLE_MULTIMODAL_GENERATE_FAILED");
      assert.match(error?.message || "", /WebSocket upgrade required/);
      assert.equal(error?.details?.requestMethod, "GET");
      assert.equal(error?.details?.requestUrl, "https://api.aicodewith.com/v1/tasks/task-426");
      return true;
    },
  );
  assert.deepEqual(requestedUrls, [
    "POST https://api.aicodewith.com/v1/images/generations",
    "GET https://api.aicodewith.com/v1/tasks/task-426",
  ]);
});

test("multimodal_generate: images_async applies official parameter defaults and beta count limit", async () => {
  const bodies = [];
  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2_beta: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://api.aicodewith.com",
          model: "gpt-image-2-beta",
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "images_async",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch(url, init = {}) {
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        if (String(url || "").endsWith("/v1/images/generations")) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({ id: `task-${bodies.length}` });
            },
          };
        }
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              status: "completed",
              result_data: [{ b64_json: Buffer.from("fake-image").toString("base64") }],
            });
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  await tool.invoke({
    generation_content: "draw a landscape",
    model_name: "gpt_image_2_beta",
    size: "16:9",
    n: 8,
  });
  await tool.invoke({
    generation_content: "draw a square",
    model_name: "gpt_image_2_beta",
    size: "1024x1024",
    resolution: "2K",
    n: 8,
  });

  assert.equal(bodies[0].size, "16:9");
  assert.equal(bodies[0].resolution, "1K");
  assert.equal(bodies[0].n, 1);
  assert.equal(bodies[1].size, "1024x1024");
  assert.equal(bodies[1].resolution, "2K");
  assert.equal(bodies[1].n, 1);
});

test("multimodal_generate: images_async adds official HTTP status hints to diagnostics", async () => {
  const runtime = {
    globalConfig: {
      providers: {
        gpt_image_2: {
          enabled: true,
          used_for_conversation: false,
          api_key: "test-key",
          base_url: "https://api.aicodewith.com",
          model: "gpt-image-2",
          format: "openai_compatible",
          providerId: "gpt_image_2",
          adapterId: "openai-compatible",
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "images_async",
            },
          },
        },
      },
    },
    userConfig: {},
    sharedTools: {
      async fetch(url) {
        if (String(url || "").endsWith("/v1/images/generations")) {
          return {
            ok: true,
            async text() {
              return JSON.stringify({ id: "task-private" });
            },
          };
        }
        return {
          ok: false,
          status: 404,
          async text() {
            return JSON.stringify({ error: "not found (request_id: req_404)" });
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  await assert.rejects(
    tool.invoke({
      generation_content: "draw a bird",
      model_name: "gpt-image-2",
      size: "auto",
    }),
    (error) => {
      assert.equal(error?.code, "RECOVERABLE_MULTIMODAL_GENERATE_FAILED");
      assert.match(error?.message || "", /not found \(request_id: req_404\)/);
      assert.doesNotMatch(error?.message || "", /任务不存在或无权访问/);
      assert.doesNotMatch(error?.message || "", /只能查询自己创建的任务/);
      assert.equal(error?.details?.requestMethod, "GET");
      assert.equal(error?.details?.requestUrl, "https://api.aicodewith.com/v1/tasks/task-private");
      return true;
    },
  );
});
