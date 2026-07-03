import test from "node:test";
import assert from "node:assert/strict";

import { createMultimodalGenerateTool } from "../../../src/system-core/tools/ai-models/multimodal-generate-tool.js";

function getMultimodalGenerateTool(runtime = {}) {
  const tools = createMultimodalGenerateTool({
    agentContext: { runtime },
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
          multimodal_generation: {
            support_understanding: false,
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
        assert.deepEqual(error?.details?.availableApiTypes, [
          "openai_responses",
          "images_async",
        ]);
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

test("multimodal_generate: explicit images_async overrides provider default api type", async () => {
  const requestedUrls = [];
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
          multimodal_generation: {
            support_understanding: false,
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
    sharedTools: {
      async fetch(url) {
        requestedUrls.push(String(url || ""));
        return {
          ok: false,
          status: 500,
          async text() {
            return "synthetic failure";
          },
        };
      },
    },
  };
  const tool = getMultimodalGenerateTool(runtime);

  await assert.rejects(
    tool.invoke({
      api_type: "images_async",
      generation_content: "draw a bird",
      model_name: "gpt-image-2",
      size: "1:1",
    }),
    (error) => {
      assert.equal(error?.details?.apiType, "images_async");
      assert.equal(error?.details?.requestMethod, "POST");
      assert.equal(error?.details?.requestUrl, "https://models.example.com/v1/images/generations");
      return true;
    },
  );
  assert.deepEqual(requestedUrls, ["https://models.example.com/v1/images/generations"]);
});

test("multimodal_generate: images_async polls task endpoint without websocket handshake", async () => {
  const requestedUrls = [];
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
          multimodal_generation: {
            support_understanding: false,
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
                result_data: [{ b64_json: `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}` }],
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

  const payload = JSON.parse(await tool.invoke({
    api_type: "images_async",
    generation_content: "draw a bird",
    model_name: "gpt-image-2",
    size: "1:1",
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.callMode, "images_async_api");
  assert.equal(payload.summary.task_id, "task-1");
  assert.equal(payload.summary.generated_image_count, 1);
  assert.deepEqual(requestedUrls, [
    `POST http://127.0.0.1:${port}/v1/images/generations`,
    `GET http://127.0.0.1:${port}/v1/tasks/task-1`,
  ]);
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
          multimodal_generation: {
            support_understanding: false,
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
        if (String(url || "") === "https://api.aicodewith.com/v1/tasks/task-unified-1777017804-vskdh190") {
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

  const payload = JSON.parse(await tool.invoke({
    api_type: "images_async",
    generation_content: "一只可爱的猫咪在阳光下打盹",
    model_name: "gpt-image-2",
    size: "1:1",
    resolution: "1K",
    n: 4,
    quality: "low",
    image_urls: ["https://your-image-url.png"],
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.task_id, "task-unified-1777017804-vskdh190");
  assert.equal(payload.summary.generated_image_count, 1);
  assert.deepEqual(requested, [
    "POST https://api.aicodewith.com/v1/images/generations",
    "GET https://api.aicodewith.com/v1/tasks/task-unified-1777017804-vskdh190",
    "GET https://cdn.example.com/generated-cat.png",
  ]);
  assert.deepEqual(bodies, [{
    model: "gpt-image-2",
    prompt: "一只可爱的猫咪在阳光下打盹",
    size: "1:1",
    resolution: "1K",
    n: 4,
    quality: "low",
    image_urls: ["https://your-image-url.png"],
  }]);
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
          multimodal_generation: {
            support_understanding: false,
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
      api_type: "images_async",
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
          multimodal_generation: {
            support_understanding: false,
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
    api_type: "images_async",
    generation_content: "draw a landscape",
    model_name: "gpt_image_2_beta",
    size: "16:9",
    n: 8,
  });
  await tool.invoke({
    api_type: "images_async",
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
          multimodal_generation: {
            support_understanding: false,
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
      api_type: "images_async",
      generation_content: "draw a bird",
      model_name: "gpt-image-2",
      size: "auto",
    }),
    (error) => {
      assert.equal(error?.code, "RECOVERABLE_MULTIMODAL_GENERATE_FAILED");
      assert.match(error?.message || "", /not found \(request_id: req_404\)/);
      assert.match(error?.message || "", /任务不存在或无权访问/);
      assert.match(error?.message || "", /只能查询自己创建的任务/);
      assert.equal(error?.details?.requestMethod, "GET");
      assert.equal(error?.details?.requestUrl, "https://api.aicodewith.com/v1/tasks/task-private");
      return true;
    },
  );
});
