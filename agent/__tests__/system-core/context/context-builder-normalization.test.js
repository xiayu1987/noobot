import test from "node:test";
import assert from "node:assert/strict";

import { ContextBuilder } from "../../../src/system-core/context/index.js";
import { buildContextMessageBlocks } from "../../../src/system-core/agent/core/context/message-builder.js";

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
  inputAttachmentMetas = null,
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
      ...(Array.isArray(inputAttachmentMetas) ? { inputAttachmentMetas } : {}),
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

test("buildInitialContext prefers inputAttachmentMetas over legacy attachmentMetas", async () => {
  const builder = createBuilderForAttachmentRuntimeTest({
    inputAttachmentMetas: [
      {
        attachmentId: "att_input",
        sessionId: "s1",
        name: "input.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/input.png",
      },
    ],
    attachmentMetas: [
      {
        attachmentId: "att_legacy",
        sessionId: "s1",
        name: "legacy.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/noobot-test-workspace/u1/runtime/attach/scoped/s1/user/legacy.png",
      },
    ],
    includeContextKeys: ["base_prompt", "system_runtime", "scenario"],
  });

  const context = await builder.buildInitialContext({ dialogProcessId: "dp_1" });
  assert.equal(
    context?.execution?.controllers?.runtime?.inputAttachmentMetas?.[0]?.attachmentId,
    "att_input",
  );
  assert.deepEqual(context?.execution?.controllers?.runtime?.attachmentMetas, []);
});

test("buildContextMessageBlocks prefers runtime inputAttachmentMetas for user meta", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            inputAttachmentMetas: [{ attachmentId: "att_input", name: "input.png" }],
            attachmentMetas: [{ attachmentId: "att_legacy", name: "legacy.png" }],
            systemRuntime: { sessionId: "s1", dialogProcessId: "dp1" },
          },
        },
      },
      payload: { messages: { system: [], history: [] } },
    },
    { currentUserMessage: "hello" },
  );
  const metaMessage = blocks.incremental.find(
    (item) => item?.additional_kwargs?.noobotInternalMessageType === "user_meta",
  );
  assert.ok(metaMessage);
  assert.equal(String(metaMessage.content || "").includes("att_input"), true);
  assert.equal(String(metaMessage.content || "").includes("att_legacy"), false);
});

test("buildInitialContext keeps input attachments separate from runtime generated attachments when attachments section is excluded", async () => {
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
  const runtime = context?.execution?.controllers?.runtime || {};
  assert.equal(Array.isArray(runtime.inputAttachmentMetas), true);
  assert.equal(runtime.inputAttachmentMetas.length, 1);
  assert.equal(runtime.inputAttachmentMetas[0]?.attachmentId, "att_1");
  assert.deepEqual(runtime.attachmentMetas, []);
});
