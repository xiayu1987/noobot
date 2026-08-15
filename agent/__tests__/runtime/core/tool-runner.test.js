/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  executeToolCall as executeToolCallWithoutTurn,
  executeToolCallInTurn,
} from "../../../src/runtime/tool-execution/tool-runner.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { confirmToolOperation } from "../../../src/tools/execution/tool-risk.js";
import { SECURITY_EVIDENCE_SOURCE } from "@noobot/security-assessment-protocol";

function executeToolCall(options = {}) {
  const runtime = options.runtime && typeof options.runtime === "object" ? options.runtime : {};
  runtime.userId = String(runtime.userId || options.userId || "test-user");
  runtime.globalConfig =
    runtime.globalConfig && typeof runtime.globalConfig === "object" ? runtime.globalConfig : {};
  runtime.globalConfig.workspaceRoot = String(
    runtime.globalConfig.workspaceRoot || runtime.basePath || os.tmpdir(),
  );
  const systemRuntime =
    runtime.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : (runtime.systemRuntime = {});
  const identity = String(options.identity || options.call?.id || "test-tool-call");
  systemRuntime.sessionId = String(systemRuntime.sessionId || "test-session");
  systemRuntime.dialogProcessId = String(systemRuntime.dialogProcessId || "test-dialog");
  systemRuntime.turnScopeId = String(systemRuntime.turnScopeId || "test-turn");
  systemRuntime.executionId = String(
    systemRuntime.executionId || `agent:${systemRuntime.turnScopeId}`,
  );
  runtime.runConfig =
    runtime.runConfig && typeof runtime.runConfig === "object" ? runtime.runConfig : {};
  runtime.runConfig.turnScopeId = String(
    runtime.runConfig.turnScopeId || systemRuntime.turnScopeId,
  );
  runtime.runConfig.executionId = String(
    runtime.runConfig.executionId || systemRuntime.executionId,
  );
  runtime.runConfig.sessionId = String(runtime.runConfig.sessionId || systemRuntime.sessionId);
  systemRuntime.messageEventStream =
    systemRuntime.messageEventStream && typeof systemRuntime.messageEventStream === "object"
      ? systemRuntime.messageEventStream
      : {
          sequence: 0,
        };
  if (!systemRuntime.messageEventStream.activeMessageId) {
    bindAssistantMessageEventStream(runtime, {
      messageId: String(options.messageId || `message-${identity}`),
      presentationMessageId: String(options.presentationMessageId || `presentation-${identity}`),
    });
  }
  return options.eventListener
    ? executeToolCallInTurn({ ...options, runtime })
    : executeToolCallWithoutTurn({ ...options, runtime });
}

function getPrimaryTransferAttachment(envelope = {}) {
  return Array.isArray(envelope?.payload?.attachments) ? envelope.payload.attachments[0] || {} : {};
}

function findTransferEnvelopeByReason(envelopes = [], reason = "") {
  return (Array.isArray(envelopes) ? envelopes : []).find(
    (item = {}) => item?.intent?.reason === reason,
  );
}

test("executeToolCall gives tools an output transfer identity named after the canonical tool", async () => {
  let identity = null;
  await executeToolCall({
    call: { id: "call-native", name: "execute_native_script", args: {} },
    tool: {
      async invoke(_args, config) {
        identity = config?.configurable?.transferIdentity;
        return JSON.stringify({ ok: true, status: "completed" });
      },
    },
  });
  assert.match(identity.transferId, /:output:execute_native_script$/);
  assert.equal(identity.transferId.includes(":output:execute_script"), false);
});

test("executeToolCall keeps resource identity internal to the runtime result", async () => {
  const result = await executeToolCall({
    call: { id: "call-resource", name: "read_file", args: {} },
    tool: {
      invoke: async () =>
        JSON.stringify({
          toolName: "read_file",
          ok: true,
          resolvedPath: "src/index.js",
          resources: [{ resourceId: "res_internal", source: "workspace" }],
        }),
    },
  });
  const publicResult = JSON.parse(result.toolResultText);
  assert.equal(publicResult.resolvedPath, "src/index.js");
  assert.equal("resources" in publicResult, false);
  assert.equal(result.internalResources[0].resourceId, "res_internal");
});

function attachmentEnvelope({
  callId,
  attachmentId,
  sessionId = "test-session",
  messageId = `message-${callId}`,
  name = "result.txt",
  mimeType = "text/plain",
  size = 0,
} = {}) {
  return {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: `transfer:${messageId}:tool:${callId}:output:tool_result_text:structured`,
    messageId,
    identity: {
      sessionId,
      turnScopeId: "test-turn",
      runId: "agent:test-turn",
      producer: { type: "tool", id: callId },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId, sessionId, attachmentSource: "model" },
          role: "primary",
          name,
          mimeType,
          size,
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  };
}

test("executeToolCall does not promote ordinary tool attachments into semantic transfer", async () => {
  const call = {
    id: "call_1",
    name: "multimodal_generate",
    args: {},
  };
  const tool = {
    invoke: async () => ({
      toolName: "multimodal_generate",
      ok: true,
      attachments: [
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
  assert.equal("extractedAttachments" in result, false);
  assert.deepEqual(result.transferEnvelopes, []);
});

test("executeToolCall preserves strict V2 transfer envelopes from structured tool results", async () => {
  const call = {
    id: "call_transfer_result",
    name: "multimodal_generate",
    args: {},
  };
  const tool = {
    invoke: async () => ({
      toolName: "multimodal_generate",
      ok: true,
      transferEnvelopes: [
        attachmentEnvelope({
          callId: call.id,
          attachmentId: "att_t1",
          name: "generated_image_1.png",
          mimeType: "image/png",
          size: 256,
        }),
      ],
    }),
  };

  const result = await executeToolCall({
    call,
    tool,
    turn: 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.transferEnvelopes.length, 1);
  assert.equal(
    getPrimaryTransferAttachment(result.transferEnvelopes[0])?.identity?.attachmentId,
    "att_t1",
  );
});

test("executeToolCall extracts strict V2 transfer envelopes from JSON tool results", async () => {
  const call = {
    id: "call_transfer_json_result",
    name: "multimodal_parse",
    args: {},
  };
  const envelope = attachmentEnvelope({
    callId: call.id,
    attachmentId: "att_json_result",
  });
  const result = await executeToolCall({
    call,
    tool: {
      invoke: async () =>
        JSON.stringify({
          toolName: call.name,
          ok: true,
          transferEnvelopes: [envelope],
        }),
    },
    turn: 1,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.transferEnvelopes, [envelope]);
});

test("executeToolCall materializes outputArtifacts through the single transfer outlet", async () => {
  const call = { id: "call_output_artifact", name: "write_file", args: {} };
  const runtime = {
    userId: "test-user",
    attachmentService: {
      async ingestGeneratedArtifacts(payload = {}) {
        return payload.artifacts.map((artifact, index) => ({
          attachmentId: `att-output-${index + 1}`,
          sessionId: payload.sessionId,
          attachmentSource: payload.attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: Buffer.from(artifact.contentBase64, "base64").length,
        }));
      },
    },
  };
  const result = await executeToolCall({
    call,
    runtime,
    tool: {
      invoke: async () =>
        JSON.stringify({
          toolName: call.name,
          ok: true,
          outputArtifacts: [
            { type: "text", name: "result.md", mimeType: "text/markdown", content: "# result" },
          ],
        }),
    },
  });
  const publicResult = JSON.parse(result.toolResultText);

  assert.equal("outputArtifacts" in publicResult, false);
  assert.equal("attachments" in publicResult, false);
  assert.equal(publicResult.transferEnvelopes.length, 1);
  assert.equal(
    publicResult.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "att-output-1",
  );
  assert.equal(result.transferEnvelopes.length, 1);
  assert.equal(result.transferEnvelopes[0].payload.attachments[0].name, "result.md");
  assert.equal(
    result.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "att-output-1",
  );
});

test("executeToolCall rejects output artifact types that differ from the registered tool policy", async () => {
  let persisted = false;
  const result = await executeToolCall({
    call: { id: "call_output_type_mismatch", name: "write_file", args: {} },
    runtime: {
      userId: "test-user",
      attachmentService: {
        async ingestGeneratedArtifacts() {
          persisted = true;
          return [];
        },
      },
    },
    tool: {
      invoke: async () => ({
        toolName: "write_file",
        ok: true,
        outputArtifacts: [
          {
            type: "attachment_bytes",
            name: "result.bin",
            mimeType: "application/octet-stream",
            contentBase64: "AQID",
          },
        ],
      }),
    },
  });

  assert.equal(result.success, false);
  assert.equal(persisted, false);
  assert.match(result.toolResultText, /semantic_transfer_tool_output_type_mismatch/);
});

test("executeToolCall does not publish writtenFiles outside semantic transfer", async () => {
  const events = [];
  const runtime = {
    userId: "test-user",
    systemRuntime: {
      sessionId: "child-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:turn-1",
      messageEventStream: {
        activeMessageId: "message-1",
        activePresentationMessageId: "child-assistant-1",
        sequence: 0,
      },
    },
  };
  await executeToolCall({
    call: { id: "call-write", name: "write_file", args: {} },
    tool: {
      invoke: async () => ({
        toolName: "write_file",
        ok: true,
        state: "OK",
        resolvedPath: "/workspace/result.txt",
        fileName: "result.txt",
        isSandbox: true,
      }),
    },
    runtime,
    messageId: "message-1",
    eventListener: { onEvent: (event) => events.push(event) },
  });

  const completed = events.find((event = {}) => event.event === "tool_call_end")?.data;
  assert.equal("writtenFiles" in completed, false);
  assert.equal(completed?.presentationMessageId, "child-assistant-1");
});

test("canonical tool events publish the server-assessed maximum risk level", async () => {
  const events = [];
  const runtime = {
    systemRuntime: {
      config: { safeConfirm: false },
    },
  };
  const result = await executeToolCall({
    call: {
      id: "call-risk",
      name: "read_file",
      args: { filePath: "notes.txt", riskLevel: "low" },
    },
    tool: {
      async invoke() {
        await confirmToolOperation({
          runtime,
          declaredRiskLevel: "low",
          serverEvidence: {
            source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
            riskLevel: "high",
          },
          toolName: "read_file",
          operation: "read file",
        });
        return { toolName: "read_file", ok: true };
      },
    },
    runtime,
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.equal(result.riskLevel, "high");
  assert.equal(result.securityAssessment.effectiveRiskLevel, "high");
  assert.deepEqual(
    result.securityAssessment.evidence.map((item) => item.source),
    ["model_declaration", "tool_profile", "normalized_resource"],
  );
  assert.deepEqual(
    result.securityAssessment.evidence.map((item) => item.riskLevel),
    ["low", "low", "high"],
  );
  assert.equal(
    events.find((event = {}) => event.event === "tool_call_start")?.data?.riskLevel,
    "low",
  );
  assert.equal(
    events.find((event = {}) => event.event === "tool_call_end")?.data?.riskLevel,
    "high",
  );
});

test("tool operation baseline risk is published even when invocation fails before confirmation", async () => {
  const events = [];
  const result = await executeToolCall({
    call: {
      id: "call-native-static-rejection",
      name: "execute_native_script",
      args: { script_body: "require('fs')" },
    },
    tool: {
      async invoke() {
        throw new Error("script_body contains forbidden runtime capability: require");
      },
    },
    runtime: { systemRuntime: { config: { safeConfirm: false } } },
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.equal(result.success, false);
  assert.equal(result.riskLevel, "medium");
  assert.equal(
    events.find((event = {}) => event.event === "tool_call_start")?.data?.riskLevel,
    "medium",
  );
  assert.equal(
    events.find((event = {}) => event.event === "tool_call_end")?.data?.riskLevel,
    "medium",
  );
});

test("canonical tool_call_end preserves a complete JSON tool result beyond 200 characters", async () => {
  const events = [];
  const resultPayload = JSON.stringify({
    toolName: "task_check",
    ok: true,
    protocolVersion: 1,
    summary: {
      state: "CONTINUE",
      abstract: "a".repeat(80),
      nextAction: "b".repeat(80),
      contentHash: `sha256:${"c".repeat(64)}`,
    },
  });
  assert.equal(resultPayload.length > 200, true);

  await executeToolCall({
    call: { id: "call-task-check", name: "task_check", args: {} },
    tool: { invoke: async () => resultPayload },
    eventListener: { onEvent: (event) => events.push(event) },
  });

  const completed = events.find((event = {}) => event.event === "tool_call_end")?.data;
  assert.equal(completed?.result, resultPayload);
  assert.deepEqual(JSON.parse(completed.result), JSON.parse(resultPayload));
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

test("executeToolCall assigns the canonical invoke code when a thrown error has no code", async () => {
  const result = await executeToolCall({
    call: { id: "call_uncoded", name: "demo_tool", args: {} },
    tool: {
      invoke: async () => {
        throw new Error("uncoded failure");
      },
    },
    turn: 1,
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "failed");
  assert.equal(payload.code, "RECOVERABLE_TOOL_INVOKE_ERROR");
  assert.equal(payload.error, "uncoded failure");
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

test("executeToolCall redacts sensitive fields from tool results before returning them", async () => {
  const tool = {
    invoke: async () => ({
      ok: true,
      token: "top-secret-token",
      nested: {
        Authorization: "Bearer top-secret-token",
        cookie: "session=top-secret-cookie",
        ordinary: "preserved",
      },
      items: [{ apiKey: "top-secret-api-key" }, { credential: "top-secret-credential" }],
    }),
  };

  const result = await executeToolCall({
    call: { id: "call_sensitive_result", name: "demo_tool", args: {} },
    tool,
    turn: 1,
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.token, "[Redacted]");
  assert.equal(payload.nested.Authorization, "[Redacted]");
  assert.equal(payload.nested.cookie, "[Redacted]");
  assert.equal(payload.nested.ordinary, "preserved");
  assert.equal(payload.items[0].apiKey, "[Redacted]");
  assert.equal(payload.items[1].credential, "[Redacted]");
  assert.doesNotMatch(result.toolResultText, /top-secret/);
});

test("executeToolCall redacts sensitive fields from recoverable error details", async () => {
  const tool = {
    invoke: async () => {
      const error = new Error("service unavailable");
      error.details = { endpoint: "weather", accessToken: "top-secret-token" };
      throw error;
    },
  };

  const result = await executeToolCall({
    call: { id: "call_sensitive_error", name: "demo_tool", args: {} },
    tool,
    turn: 1,
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.details.endpoint, "weather");
  assert.equal(payload.details.accessToken, "[Redacted]");
  assert.doesNotMatch(result.toolResultText, /top-secret/);
});

test("executeToolCall hook payload includes normalized runtime meta", async () => {
  const hookManager = createHookManager();
  const starts = [];
  const ends = [];
  hookManager.on(
    HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
    async (ctx = {}) => {
      starts.push(ctx);
    },
    { id: "test.tool-call.before" },
  );
  hookManager.on(
    HOOK_POINT.AGENT.AFTER_TOOL_CALL,
    async (ctx = {}) => {
      ends.push(ctx);
    },
    { id: "test.tool-call.after" },
  );

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

test("executeToolCall: tool result too long should be persisted as a V2 attachment reference", async () => {
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
        },
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "global" },
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
  const overflowEnvelope = findTransferEnvelopeByReason(
    payload.transferEnvelopes,
    "tool_result_overflow",
  );
  const overflowAttachment = getPrimaryTransferAttachment(overflowEnvelope);
  assert.equal(overflowEnvelope.version, 2);
  assert.equal(overflowEnvelope.payload.mode, "attachment");
  assert.equal(overflowAttachment.identity.sessionId, "session-overflow-1");
  assert.equal(overflowAttachment.identity.attachmentSource, "model");
  assert.equal(overflowAttachment.name, "demo_tool.result.txt");
  assert.equal(JSON.stringify(overflowEnvelope).includes("filePath"), false);
});

test("executeToolCall: overflow length is measured after compacting transfer wrappers", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-compact-"));
  const envelope = attachmentEnvelope({
    callId: "call_compact_not_overflow",
    attachmentId: "att_compact_1",
    name: "result.md",
    mimeType: "text/markdown",
    size: 12,
  });
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "demo_tool",
        ok: true,
        status: "completed",
        text: "短结果",
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
  assert.equal(Array.isArray(payload.transferEnvelopes), true);
  assert.equal("transferResult" in payload, false);
  assert.equal("transferEnvelopes" in payload, true);
  assert.equal("attachmentMetas" in payload, false);
  assert.equal("transferFiles" in payload, false);
  assert.equal(
    getPrimaryTransferAttachment(payload.transferEnvelopes[0]).identity.attachmentId,
    "att_compact_1",
  );
});

test("executeToolCall: overflow keeps original semantic-transfer artifact and compacts duplicates", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-transfer-"));
  const envelope = attachmentEnvelope({
    callId: "call_overflow_transfer",
    attachmentId: "att_real_1",
    name: "generated.png",
    mimeType: "image/png",
    size: 128,
  });
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "multimodal_generate",
        ok: true,
        status: "completed",
        text: "x".repeat(500),
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
  assert.equal("extractedAttachments" in result, false);
  assert.equal(result.transferEnvelopes.length >= 1, true);
  const overflowEnvelope = findTransferEnvelopeByReason(
    payload.transferEnvelopes,
    "tool_result_overflow",
  );
  assert.equal(overflowEnvelope.version, 2);
  assert.equal(overflowEnvelope.payload.mode, "attachment");
  assert.equal(JSON.stringify(overflowEnvelope).includes("filePath"), false);
});

test("executeToolCall task_summary returns transfer metadata without phase summary content", async () => {
  const summaryContent = "阶段小结：敏感小结文本不应出现在工具返回中。";
  const call = {
    id: "call_task_summary_transfer",
    name: "task_summary",
    args: { summaryContent },
  };
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "task_summary",
        ok: true,
        status: "completed",
        protocolVersion: 1,
        summary: {
          state: "CONTINUE",
          abstract: "完成阶段工作。",
          nextAction: "继续验证。",
          contentHash: "sha256:0123456789abcdef",
        },
        message: "请根据小结后的状态、摘要和下一步处理后续流程。",
        phaseSummary: summaryContent,
        summarizedMessages: { currentTurn: 3 },
        extraField: "should be omitted for task_summary",
      }),
  };
  const runtime = {
    attachmentService: {
      async ingestGeneratedArtifacts(payload) {
        return payload.artifacts.map((artifact, index) => ({
          attachmentId: `task-summary-runner-${index + 1}`,
          sessionId: payload.sessionId,
          attachmentSource: payload.attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: summaryContent.length,
          path: `/host/${artifact.name}`,
          relativePath: `attachments/${artifact.name}`,
          generatedByModel: true,
          generationSource: payload.generationSource,
        }));
      },
    },
    systemRuntime: { userId: "u1", sessionId: "s1" },
  };

  const result = await executeToolCall({
    call,
    tool,
    runtime,
    sessionId: "s1",
    turn: 1,
  });

  assert.equal(result.success, true);
  assert.equal(result.toolResultText.includes(summaryContent), false);
  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.toolName, "task_summary");
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.protocolVersion, 1);
  assert.deepEqual(payload.summary, {
    state: "CONTINUE",
    abstract: "完成阶段工作。",
    nextAction: "继续验证。",
    contentHash: "sha256:0123456789abcdef",
  });
  assert.equal(payload.phaseSummary, undefined);
  assert.equal(payload.extraField, undefined);
  assert.equal(payload.toolInputOverflow, undefined);
  assert.equal(payload.transferFiles, undefined);
  assert.equal(
    payload.transferEnvelopes?.[0]?.payload?.attachments?.[0]?.name,
    "task-summary-content.tool-input.md",
  );
});

test("executeToolCall: overflow result never exposes sandbox or host paths", async () => {
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
        },
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "user" },
          },
        },
      },
      userConfig: {},
      sharedTools: {
        resolveAttachmentDisplayPath({ meta = {} } = {}) {
          return String(meta?.path || "").replace(basePath, "/injected/primary-user");
        },
        resolveSandboxPath({ hostPath }) {
          return String(hostPath || "").replace(basePath, "/workspace/primary-user");
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
  const overflowEnvelope = findTransferEnvelopeByReason(
    payload.transferEnvelopes,
    "tool_result_overflow",
  );
  assert.equal(overflowEnvelope.version, 2);
  assert.equal(overflowEnvelope.payload.mode, "attachment");
  assert.equal(JSON.stringify(overflowEnvelope).includes("filePath"), false);
  assert.equal(JSON.stringify(overflowEnvelope).includes("sandboxPath"), false);
  assert.equal(JSON.stringify(overflowEnvelope).includes("hostPath"), false);
});
