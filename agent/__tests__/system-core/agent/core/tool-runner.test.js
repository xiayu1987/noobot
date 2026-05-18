import test from "node:test";
import assert from "node:assert/strict";

import { executeToolCall } from "../../../../src/system-core/agent/core/execution/tool-runner.js";
import { createHookManager, HOOK_POINTS } from "../../../../src/system-core/hook/index.js";

test("executeToolCall extracts attachmentMetas from multimodal tool result", async () => {
  const call = {
    id: "call_1",
    name: "multimodal_generate",
    args: {},
  };
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "multimodal_generate",
        ok: true,
        attachmentMetas: [
          {
            attachmentId: "att_1",
            name: "generated_image_1.png",
            mimeType: "image/png",
            size: 123,
            sessionId: "s1",
            attachmentSource: "model",
            path: "/tmp/a.png",
            relativePath: "runtime/attach/scoped/s1/model/a.png",
            generatedByModel: true,
            generationSource: "multimodal_generate_tool",
          },
        ],
      }),
  };

  const result = await executeToolCall({
    call,
    tool,
    turn: 1,
  });

  assert.equal(result.success, true);
  assert.equal(Array.isArray(result.extractedAttachmentMetas), true);
  assert.equal(result.extractedAttachmentMetas.length, 1);
  assert.equal(
    result.extractedAttachmentMetas[0]?.relativePath,
    "runtime/attach/scoped/s1/model/a.png",
  );
});

test("executeToolCall returns toToolJsonResult when tool is missing", async () => {
  const result = await executeToolCall({
    call: { id: "call_missing", name: "unknown_tool", args: {} },
    tool: null,
    turn: 1,
  });

  assert.equal(result.success, false);
  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "RECOVERABLE_TOOL_NOT_FOUND");
  assert.equal(payload.toolName, "unknown_tool");
});

test("executeToolCall returns toToolJsonResult when tool invoke throws recoverable error", async () => {
  const tool = {
    invoke: async () => {
      const error = new Error("invalid tool args");
      error.code = "RECOVERABLE_INVALID_TOOL_ARGS";
      throw error;
    },
  };

  const result = await executeToolCall({
    call: { id: "call_bad", name: "demo_tool", args: {} },
    tool,
    turn: 1,
  });

  assert.equal(result.success, false);
  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "RECOVERABLE_INVALID_TOOL_ARGS");
  assert.equal(payload.error, "invalid tool args");
  assert.equal(payload.toolName, "demo_tool");
});

test("executeToolCall includes error details from recoverable error", async () => {
  const tool = {
    invoke: async () => {
      const error = new Error("service unavailable");
      error.code = "RECOVERABLE_SERVICE_UNAVAILABLE";
      error.details = { serviceName: "weather", endpointName: "forecast" };
      throw error;
    },
  };
  const result = await executeToolCall({
    call: { id: "call_detail", name: "call_service", args: {} },
    tool,
    turn: 1,
  });
  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "RECOVERABLE_SERVICE_UNAVAILABLE");
  assert.deepEqual(payload.details, {
    serviceName: "weather",
    endpointName: "forecast",
  });
});

test("executeToolCall hook payload includes normalized runtime meta", async () => {
  const hookManager = createHookManager();
  const starts = [];
  const ends = [];
  hookManager.on(HOOK_POINTS.BEFORE_TOOL_CALL, async (ctx = {}) => {
    starts.push(ctx);
  });
  hookManager.on(HOOK_POINTS.AFTER_TOOL_CALL, async (ctx = {}) => {
    ends.push(ctx);
  });

  const tool = {
    invoke: async () => ({ ok: true }),
  };
  const runtime = {
    userId: "runtime_user",
    systemRuntime: {
      sessionId: "session_1",
      parentSessionId: "parent_1",
      dialogProcessId: "dp_1",
      caller: "user",
    },
    hookManager,
  };

  await executeToolCall({
    call: { id: "call_meta", name: "meta_tool", args: { q: 1 } },
    tool,
    turn: 2,
    runtime,
  });

  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1);
  assert.equal(starts[0].phase, "tool_call");
  assert.equal(starts[0].status, "start");
  assert.equal(starts[0].userId, "runtime_user");
  assert.equal(starts[0].sessionId, "session_1");
  assert.equal(starts[0].parentSessionId, "parent_1");
  assert.equal(starts[0].dialogProcessId, "dp_1");
  assert.equal(starts[0].caller, "user");
  assert.equal(typeof starts[0].startedAt, "string");
  assert.equal(ends[0].status, "success");
  assert.equal(Number.isFinite(ends[0].durationMs), true);
});
