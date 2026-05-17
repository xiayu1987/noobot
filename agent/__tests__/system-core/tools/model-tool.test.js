import test from "node:test";
import assert from "node:assert/strict";

import { createModelTool } from "../../../src/system-core/tools/ai-models/model-tool.js";

function parseToolJson(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

function getSwitchModelTool({ runtime = {}, sessionId = "session-1" } = {}) {
  const tools = createModelTool({
    agentContext: { runtime },
    sessionId,
  });
  const switchModelTool = tools.find((toolItem) => toolItem?.name === "switch_model");
  assert.ok(switchModelTool, "switch_model 工具应存在");
  return switchModelTool;
}

test("switch_model: 应能通过 alias 切换模型", async () => {
  let persistedPayload = null;
  const runtime = {
    allEnabledProviders: {
      openai: { model: "gpt-4o" },
      anthropic: { model: "claude-3-7-sonnet" },
    },
    userId: "u1",
    systemRuntime: { sessionId: "s-1" },
    sessionManager: {
      async setSessionModelAlias(payload = {}) {
        persistedPayload = payload;
      },
    },
    runtimeModel: "",
  };
  const switchModelTool = getSwitchModelTool({ runtime, sessionId: "s-1" });

  const result = parseToolJson(await switchModelTool.invoke({ modelName: "openai" }));

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "s-1");
  assert.equal(result.modelAlias, "openai");
  assert.equal(runtime.runtimeModel, "openai");
  assert.deepEqual(persistedPayload, {
    userId: "u1",
    sessionId: "s-1",
    modelAlias: "openai",
  });
});

test("switch_model: 应能通过 modelName 映射到 alias 并切换", async () => {
  const runtime = {
    allEnabledProviders: {
      openai: { model: "gpt-4o" },
      gemini: { model: "gemini-2.5-pro" },
    },
    runtimeModel: "",
  };
  const switchModelTool = getSwitchModelTool({ runtime, sessionId: "s-2" });

  const result = parseToolJson(await switchModelTool.invoke({ modelName: "gemini-2.5-pro" }));

  assert.equal(result.ok, true);
  assert.equal(result.modelAlias, "gemini");
  assert.equal(runtime.runtimeModel, "gemini");
});

test("switch_model: 不存在的模型应返回失败", async () => {
  const runtime = {
    allEnabledProviders: {
      openai: { model: "gpt-4o" },
    },
    runtimeModel: "openai",
  };
  const switchModelTool = getSwitchModelTool({ runtime, sessionId: "s-3" });

  await assert.rejects(
    switchModelTool.invoke({ modelName: "not-exists" }),
    (error) => error?.code === "RECOVERABLE_MODEL_NOT_FOUND",
  );
  assert.equal(runtime.runtimeModel, "openai");
});

test("switch_model: 非会话模型（used_for_conversation=false）应拒绝切换", async () => {
  const runtime = {
    allEnabledProviders: {
      openai: { model: "gpt-4o", used_for_conversation: true },
      image_only: { model: "gpt-image-1", used_for_conversation: false },
    },
    runtimeModel: "openai",
  };
  const switchModelTool = getSwitchModelTool({ runtime, sessionId: "s-4" });

  await assert.rejects(
    switchModelTool.invoke({ modelName: "image_only" }),
    (error) => error?.code === "RECOVERABLE_MODEL_NOT_CONVERSATION",
  );
  assert.equal(runtime.runtimeModel, "openai");
});

test("switch_model: 缺少 sessionId 时应返回 session context missing", async () => {
  const runtime = {
    allEnabledProviders: {
      openai: { model: "gpt-4o" },
    },
    runtimeModel: "",
  };
  const switchModelTool = getSwitchModelTool({ runtime, sessionId: "" });

  await assert.rejects(
    switchModelTool.invoke({ modelName: "openai" }),
    (error) => error?.code === "RECOVERABLE_SESSION_CONTEXT_MISSING",
  );
  assert.equal(runtime.runtimeModel, "");
});
