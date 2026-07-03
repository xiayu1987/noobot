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
