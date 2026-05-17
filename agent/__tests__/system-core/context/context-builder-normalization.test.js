import test from "node:test";
import assert from "node:assert/strict";

import { ContextBuilder } from "../../../src/system-core/context/index.js";

function createBuilderForNormalizationTest() {
  return new ContextBuilder({
    config: {
      globalConfig: {},
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: null,
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachmentMetas: [],
      runConfig: {},
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

function createBuilderForAttachmentRuntimeTest({
  attachmentMetas = [],
  includeContextKeys = [],
} = {}) {
  return new ContextBuilder({
    config: {
      globalConfig: {
        workspaceRoot: "/tmp/noobot-test-workspace",
      },
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: {},
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachmentMetas,
      runConfig: {
        contextPolicy: {
          includeContextKeys,
        },
      },
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

test("_normalizeSessionRecordsForConversation filters summarized and orphan tool results", () => {
  const builder = createBuilderForNormalizationTest();
  const input = [
    { role: "assistant", content: "summarized", summarized: true },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_1",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "orphan_call",
    },
  ];

  const result = builder._normalizeSessionRecordsForConversation(input);
  assert.equal(result.some((messageItem) => messageItem?.summarized === true), false);
  assert.equal(
    result.some(
      (messageItem) =>
        messageItem?.role === "tool" &&
        String(messageItem?.tool_call_id || "") === "orphan_call",
    ),
    false,
  );
});

test("buildInitialContext keeps runtime attachments even when attachments section is excluded", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    attachmentMetas: [
      {
        attachmentId: "att_1",
        sessionId: "s1",
        name: "image.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/att_1.png",
      },
    ],
    includeContextKeys: ["base_prompt", "system_runtime", "scenario"],
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp_1" });
  const runtimeAttachmentMetas =
    context?.execution?.controllers?.runtime?.attachmentMetas || [];

  assert.equal(Array.isArray(runtimeAttachmentMetas), true);
  assert.equal(runtimeAttachmentMetas.length, 1);
  assert.equal(runtimeAttachmentMetas[0]?.attachmentId, "att_1");
});
