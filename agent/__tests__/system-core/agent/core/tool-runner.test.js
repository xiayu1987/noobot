import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executeToolCall } from "../../../../src/system-core/agent/core/execution/tool-runner.js";
import { createAgentHookManager, AGENT_HOOK_POINTS } from "../../../../src/system-core/hook/index.js";

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

test("executeToolCall extracts attachmentMetas from transferResult envelope", async () => {
  const call = {
    id: "call_transfer_result",
    name: "multimodal_generate",
    args: {},
  };
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "multimodal_generate",
        ok: true,
        transferResult: {
          ok: true,
          status: "file",
          envelope: {
            protocol: "noobot.semantic-transfer",
            version: 1,
            direction: "output",
            transport: "file",
            files: [
              {
                filePath: "/workspace/generated_image_1.png",
                attachmentMeta: {
                  attachmentId: "att_t1",
                  name: "generated_image_1.png",
                  mimeType: "image/png",
                  size: 256,
                  sessionId: "s1",
                  attachmentSource: "model",
                  path: "/tmp/generated_image_1.png",
                  relativePath: "runtime/attach/scoped/s1/model/generated_image_1.png",
                  generatedByModel: true,
                  generationSource: "multimodal_generate_tool",
                },
              },
            ],
          },
        },
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
  assert.equal(result.extractedAttachmentMetas[0]?.attachmentId, "att_t1");
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
  const hookManager = createAgentHookManager();
  const starts = [];
  const ends = [];
  hookManager.on(AGENT_HOOK_POINTS.BEFORE_TOOL_CALL, async (ctx = {}) => {
    starts.push(ctx);
  });
  hookManager.on(AGENT_HOOK_POINTS.AFTER_TOOL_CALL, async (ctx = {}) => {
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

test("executeToolCall: tool result too long should be persisted and return overflow file path", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-"));
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "demo_tool",
        ok: true,
        text: "x".repeat(500),
      }),
  };

  const result = await executeToolCall({
    call: { id: "call_overflow", name: "demo_tool", args: {} },
    tool,
    turn: 1,
    sessionId: "session-overflow-1",
    runtime: {
      basePath,
      globalConfig: {
        tools: {
          maxToolResultChars: 120,
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: {
                dockerContainerScope: "global",
              },
            },
          },
        },
      },
      userConfig: {},
    },
    agentContext: {
      environment: {
        workspace: { basePath },
      },
    },
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, true);
  assert.equal(payload.overflowed, true);
  const overflowEnvelope = Array.isArray(payload.transferEnvelopes)
    ? payload.transferEnvelopes.find((item = {}) => String(item?.filePath || "").includes(".tool-result-overflow/"))
    : null;
  assert.equal(typeof overflowEnvelope?.filePath, "string");
  assert.equal(overflowEnvelope.filePath.includes(".tool-result-overflow"), true);
  assert.equal(overflowEnvelope.filePath.includes(".tool-result-overflow/session-overflow-1/"), true);

  const overflowHostPath = String(
    overflowEnvelope?.pathView?.hostPath ||
      overflowEnvelope?.filePath ||
      "",
  );
  const overflowFileContent = await fs.readFile(overflowHostPath, "utf8");
  const overflowPayload = JSON.parse(overflowFileContent);
  assert.equal(overflowPayload.toolName, "demo_tool");
  assert.equal(overflowPayload.overflowFormat, "compact-v1");
  assert.equal(typeof overflowPayload.result, "object");
  assert.equal(typeof overflowPayload.result.text, "string");
});

test("executeToolCall: overflow length is measured after compacting transfer wrappers", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-compact-"));
  const attachmentMeta = {
    attachmentId: "att_compact_1",
    name: "result.md",
    mimeType: "text/markdown",
    size: 12,
    sessionId: "s1",
    attachmentSource: "model",
    path: "/host/result.md",
    relativePath: "runtime/attach/scoped/s1/model/result.md",
    generatedByModel: true,
    generationSource: "unit_test",
  };
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/result.md",
    attachmentMeta,
    files: [{ filePath: "/workspace/result.md", attachmentMeta }],
  };
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "demo_tool",
        ok: true,
        status: "completed",
        text: "短结果",
        attachmentMetas: [attachmentMeta],
        transferResult: {
          ok: true,
          status: "file",
          envelope,
          debugPayloadShouldNotCountAsModelResult: "x".repeat(3000),
        },
        transferEnvelopes: [envelope],
      }),
  };

  const result = await executeToolCall({
    call: { id: "call_compact_not_overflow", name: "demo_tool", args: {} },
    tool,
    turn: 1,
    runtime: {
      basePath,
      globalConfig: { tools: { maxToolResultChars: 1000 } },
      userConfig: {},
    },
    agentContext: {
      environment: {
        workspace: { basePath },
      },
    },
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.overflowed, undefined);
  assert.equal(payload.transferEnvelopes, undefined);
  assert.equal("transferResult" in payload, false);
  assert.equal("transferEnvelopes" in payload, false);
  assert.equal("attachmentMetas" in payload, false);
  assert.equal(Array.isArray(payload.transferFiles), true);
  assert.equal(payload.transferFiles[0].attachmentId, "att_compact_1");
});

test("executeToolCall: overflow keeps original semantic-transfer artifact and compacts duplicates", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-transfer-"));
  const attachmentMeta = {
    attachmentId: "att_real_1",
    name: "generated.png",
    mimeType: "image/png",
    size: 128,
    sessionId: "s1",
    attachmentSource: "model",
    path: "/tmp/generated.png",
    relativePath: "runtime/attach/scoped/s1/model/generated.png",
    generatedByModel: true,
    generationSource: "multimodal_generate_tool",
  };
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/generated.png",
    attachmentMeta,
    files: [{ filePath: "/workspace/generated.png", attachmentMeta }],
  };
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "multimodal_generate",
        ok: true,
        status: "completed",
        text: "x".repeat(500),
        attachmentMetas: [attachmentMeta],
        transferResult: { ok: true, status: "file", envelope },
        transferEnvelopes: [envelope],
      }),
  };

  const result = await executeToolCall({
    call: { id: "call_overflow_transfer", name: "multimodal_generate", args: {} },
    tool,
    turn: 1,
    runtime: {
      basePath,
      globalConfig: { tools: { maxToolResultChars: 120 } },
      userConfig: {},
    },
    agentContext: {
      environment: {
        workspace: { basePath },
      },
    },
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.overflowed, true);
  assert.equal(Array.isArray(payload.transferEnvelopes), true);
  assert.equal(payload.transferEnvelopes.length >= 1, true);
  assert.equal(
    result.extractedAttachmentMetas.some((item) => item?.attachmentId === "att_real_1"),
    true,
  );

  const overflowEnvelope = Array.isArray(payload.transferEnvelopes)
    ? payload.transferEnvelopes.find((item = {}) => String(item?.filePath || "").includes(".tool-result-overflow/"))
    : null;
  const overflowHostPath = String(overflowEnvelope?.pathView?.hostPath || overflowEnvelope?.filePath || "");
  const overflowPayload = JSON.parse(await fs.readFile(overflowHostPath, "utf8"));
  assert.equal(Array.isArray(overflowPayload.result.transferEnvelopes), true);
  assert.equal(overflowPayload.result.transferEnvelopes.length >= 1, true);
  assert.equal("transferResult" in overflowPayload.result, false);
  assert.equal("transferEnvelopes" in overflowPayload.result, true);
  assert.equal("attachmentMetas" in overflowPayload.result, false);
  const compactEnvelope = overflowPayload.result.transferEnvelopes.find(
    (item = {}) => Array.isArray(item?.files) && item.files.some((f = {}) => f?.attachmentMeta?.attachmentId === "att_real_1"),
  ) || overflowPayload.result.transferEnvelopes[0];
  assert.equal("filePath" in compactEnvelope, false);
  assert.equal("attachmentMeta" in compactEnvelope, false);
  assert.equal("pathView" in compactEnvelope, false);
  assert.equal(compactEnvelope.files[0].attachmentMeta.attachmentId, "att_real_1");
  assert.equal("name" in compactEnvelope.files[0], false);
  assert.equal("mimeType" in compactEnvelope.files[0], false);
  assert.equal("size" in compactEnvelope.files[0], false);
});

test("executeToolCall: overflow result should include sandbox path when resolver is provided", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-sandbox-"));
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "demo_tool",
        ok: true,
        text: "x".repeat(500),
      }),
  };

  const result = await executeToolCall({
    call: { id: "call_overflow_sandbox", name: "demo_tool", args: {} },
    tool,
    turn: 1,
    runtime: {
      basePath,
      globalConfig: {
        tools: {
          maxToolResultChars: 120,
          execute_script: {
            sandboxMode: true,
          },
        },
      },
      userConfig: {},
      sharedTools: {
        resolveAttachmentDisplayPath({ meta = {} } = {}) {
          return String(meta?.path || "").replace(basePath, "/injected/admin");
        },
        resolveSandboxPath({ hostPath }) {
          return String(hostPath || "").replace(basePath, "/workspace/admin");
        },
      },
    },
    agentContext: {
      environment: {
        workspace: { basePath },
      },
    },
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.overflowed, true);
  const overflowEnvelope = Array.isArray(payload.transferEnvelopes)
    ? payload.transferEnvelopes.find((item = {}) => String(item?.filePath || "").includes(".tool-result-overflow/"))
    : null;
  assert.equal(typeof overflowEnvelope?.pathView?.sandboxPath, "string");
  assert.equal(
    overflowEnvelope.pathView.sandboxPath.startsWith("/workspace/"),
    true,
  );
  assert.equal(
    overflowEnvelope.pathView.sandboxPath.includes(
      "/runtime/ops_workdir/.tool-result-overflow/",
    ),
    true,
  );
});
