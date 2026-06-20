import { describe, expect, it } from "vitest";

import { buildChatPayload } from "../../../../src/composables/chat/chatEngine/payload";

describe("buildChatPayload model preferences", () => {
  it("writes selectedModel and current scenario pluginModelConfig to config payload", () => {
    const payload = buildChatPayload({
      userId: "admin",
      message: "hello",
      requestedTextStreaming: true,
      botScenario: "programming",
      selectedModel: "main-programming",
      pluginModelConfig: {
        harness: { stepModels: { planning: "harness-programming" } },
        workflow: { semanticModel: "workflow-programming" },
      },
      locale: "zh-CN",
      selectedPlugins: { value: ["harness", "workflow"] },
    });

    expect(payload.config).toMatchObject({
      scenario: "programming",
      selectedModel: "main-programming",
      pluginModelConfig: {
        harness: { stepModels: { planning: "harness-programming" } },
        workflow: { semanticModel: "workflow-programming" },
      },
      selectedPlugins: ["harness", "workflow"],
    });
  });
});
