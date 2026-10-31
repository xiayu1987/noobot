/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createHookManager, HOOK_PHASE_STATUS, HOOK_POINT } from "@noobot/hook-protocol";
import { confirmToolOperation } from "../../../src/tools/execution/tool-risk.js";
import { SECURITY_EVIDENCE_SOURCE } from "@noobot/security-assessment-protocol";
import { formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import {
  attachmentEnvelope,
  executeToolCall,
  findCommittedMessagePayload,
  getPrimaryTransferAttachment,
} from "./tool-runner.test-helpers.js";
import {
  createTestRuntimeContext,
  createTestAttachmentService,
} from "../../helpers/test-runtime-context.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  assertMutationRef,
  createFileDiff,
  createFileMutationResult,
} from "@noobot/file-mutation-protocol";

const MUTATION_ID = "11111111-1111-4111-8111-111111111111";

function committedMutationResult() {
  return createFileMutationResult({
    id: MUTATION_ID,
    operation: "update",
    locator: { view: "workspace", path: "src/example.js" },
    fileName: "example.js",
    before: {
      exists: true,
      isText: true,
      size: 4,
      sha256: "before",
      snapshotRef: { mutationId: MUTATION_ID, section: "before" },
    },
    after: {
      exists: true,
      isText: true,
      size: 4,
      sha256: "after",
      snapshotRef: { mutationId: MUTATION_ID, section: "after" },
    },
    diff: createFileDiff("old\n", "new\n"),
    sessionScope: null,
  });
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

test("executeToolCall keeps read resources internal and out of resourceRefs", async () => {
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
  assert.deepEqual(result.resourceRefs, []);
});

test("executeToolCall promotes only declared outputResources into resourceRefs", async () => {
  const result = await executeToolCall({
    call: { id: "call-output", name: "write_file", args: {} },
    tool: {
      invoke: async () =>
        JSON.stringify({
          toolName: "write_file",
          ok: true,
          resources: [{ resourceId: "res_read", source: "workspace" }],
          outputResources: [{ resourceId: "res_written", source: "workspace" }],
        }),
    },
  });
  const publicResult = JSON.parse(result.toolResultText);
  assert.equal("outputResources" in publicResult, false);
  assert.deepEqual(
    result.resourceRefs.map((item) => item.resourceId),
    ["res_written"],
  );
});

test("executeToolCall rejects a non-array outputResources declaration", async () => {
  await assert.rejects(
    executeToolCall({
      call: { id: "call-bad-output", name: "write_file", args: {} },
      tool: {
        invoke: async () =>
          JSON.stringify({ toolName: "write_file", ok: true, outputResources: { bad: true } }),
      },
    }),
    /outputResources must be an array/,
  );
});

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
  const runtime = createTestRuntimeContext({
    attachmentService: createTestAttachmentService({
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
    }),
  });
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
  assert.deepEqual(publicResult.attachmentRefs, [
    formatAttachmentIdentityRef(result.transferEnvelopes[0].payload.attachments[0].identity),
  ]);
  assert.equal(publicResult.transferEnvelopes, undefined);
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
    runtime: createTestRuntimeContext({
      attachmentService: createTestAttachmentService({
        async ingestGeneratedArtifacts() {
          persisted = true;
          return [];
        },
      }),
    }),
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
  const runtime = createTestRuntimeContext({
    identity: {
      userId: "test-user",
      sessionId: "child-session",
      parentSessionId: "",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:turn-1",
      caller: SESSION_CALLER.USER,
    },
    eventListener: { onEvent: (event) => events.push(event) },
  });
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
    identity: {
      userId: "test-user",
      sessionId: "child-session",
      rootSessionId: "child-session",
      parentSessionId: "",
      dialogProcessId: "child-dialog",
      turnScopeId: "workflow-node:turn-1",
      runId: "agent:workflow-node:turn-1",
      presentationMessageId: "child-assistant-1",
    },
  });

  const completed = findCommittedMessagePayload(events, "tool_call_end");
  assert.equal("writtenFiles" in completed, false);
  assert.equal(completed?.presentationMessageId, "child-assistant-1");
});

test("canonical tool events publish the server-assessed maximum risk level", async () => {
  const events = [];
  const runtime = createTestRuntimeContext({
    eventListener: { onEvent: (event) => events.push(event) },
    systemRuntime: { config: { safeConfirm: false } },
  });
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
  assert.equal(findCommittedMessagePayload(events, "tool_call_start")?.riskLevel, "low");
  assert.equal(findCommittedMessagePayload(events, "tool_call_end")?.riskLevel, "high");
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
    runtime: createTestRuntimeContext({
      eventListener: { onEvent: (event) => events.push(event) },
      systemRuntime: { config: { safeConfirm: false } },
    }),
  });

  assert.equal(result.success, false);
  assert.equal(result.riskLevel, "medium");
  assert.equal(findCommittedMessagePayload(events, "tool_call_start")?.riskLevel, "medium");
  assert.equal(findCommittedMessagePayload(events, "tool_call_end")?.riskLevel, "medium");
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
    runtime: createTestRuntimeContext({
      eventListener: { onEvent: (event) => events.push(event) },
    }),
  });

  const completed = findCommittedMessagePayload(events, "tool_call_end");
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
  assert.equal(Object.hasOwn(payload, "status"), false);
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
  const runtime = createTestRuntimeContext({
    identity: {
      userId: "runtime_user",
      sessionId: "session_1",
      parentSessionId: "parent_1",
      dialogProcessId: "dp_1",
      turnScopeId: "turn-call_meta",
      caller: SESSION_CALLER.USER,
    },
    systemRuntime: {},
    runConfig: { hookManager },
  });

  await executeToolCall({
    call: { id: "call_meta", name: "meta_tool", args: { q: 1 } },
    tool,
    turn: 2,
    runtime,
    identity: {
      userId: "runtime_user",
      sessionId: "session_1",
      rootSessionId: "parent_1",
      parentSessionId: "parent_1",
      dialogProcessId: "dp_1",
      turnScopeId: "turn-call_meta",
      runId: "run-call_meta",
      presentationMessageId: "message-call_meta",
    },
  });

  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1);
  assert.equal(starts[0].phase, "tool_call");
  assert.equal(starts[0].status, HOOK_PHASE_STATUS.RUNNING);
  assert.equal(starts[0].userId, "runtime_user");
  assert.equal(starts[0].sessionId, "session_1");
  assert.equal(starts[0].parentSessionId, "parent_1");
  assert.equal(starts[0].dialogProcessId, "dp_1");
  assert.equal(starts[0].caller, "user");
  assert.equal(typeof starts[0].startedAt, "string");
  assert.equal(ends[0].status, HOOK_PHASE_STATUS.SUCCESS);
  assert.equal(Number.isFinite(ends[0].durationMs), true);
});

test("executeToolCallInTurn repairs stringified scalar args before start event and invocation", async () => {
  const events = [];
  let invokedArgs = null;
  const result = await executeToolCall({
    call: {
      id: "call-repair",
      name: "patch_file",
      args: { patch: "x", dryRun: "false", maxLines: "60" },
    },
    tool: {
      schema: z.object({
        patch: z.string(),
        dryRun: z.boolean().optional().default(false),
        maxLines: z.number().int().min(1).optional().default(1000),
      }),
      async invoke(args) {
        invokedArgs = args;
        return { toolName: "patch_file", ok: true };
      },
    },
    runtime: createTestRuntimeContext({
      eventListener: { onEvent: (event) => events.push(event) },
      systemRuntime: { config: { safeConfirm: false } },
    }),
  });

  assert.equal(result.success, true);
  assert.deepEqual(invokedArgs, { patch: "x", dryRun: false, maxLines: 60 });
  assert.deepEqual(findCommittedMessagePayload(events, "tool_call_start")?.args, {
    patch: "x",
    dryRun: false,
    maxLines: 60,
  });
  const repaired = events.find((event) => event.event === "tool_args_repaired");
  assert.equal(repaired?.data?.toolCallId, "call-repair");
  assert.deepEqual(repaired?.data?.repairs, [
    { path: ["dryRun"], from: "false", to: false },
    { path: ["maxLines"], from: "60", to: 60 },
  ]);
});

test("executeToolCallInTurn leaves unrepairable args untouched and emits no repair event", async () => {
  const events = [];
  let invokedArgs = null;
  await executeToolCall({
    call: { id: "call-no-repair", name: "patch_file", args: { patch: "x", dryRun: "yes" } },
    tool: {
      schema: z.object({ patch: z.string(), dryRun: z.boolean().optional() }),
      async invoke(args) {
        invokedArgs = args;
        return { toolName: "patch_file", ok: true };
      },
    },
    runtime: createTestRuntimeContext({
      eventListener: { onEvent: (event) => events.push(event) },
      systemRuntime: { config: { safeConfirm: false } },
    }),
  });

  assert.deepEqual(invokedArgs, { patch: "x", dryRun: "yes" });
  assert.equal(
    events.some((event) => event.event === "tool_args_repaired"),
    false,
  );
});

test("executeToolCall classifies an uncoded invoke error as retryable, matching its result code", async () => {
  const events = [];
  const result = await executeToolCall({
    call: { id: "call-uncoded-class", name: "read_file", args: {} },
    tool: {
      invoke: async () => {
        throw new Error("uncoded invoke failure");
      },
    },
    runtime: createTestRuntimeContext({
      eventListener: { onEvent: (event) => events.push(event) },
      systemRuntime: { config: { safeConfirm: false } },
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.code, "RECOVERABLE_TOOL_INVOKE_ERROR");
  const errorEvent = events.find((event) => event.event === "tool_call_error");
  assert.equal(errorEvent?.data?.classification, "retryable");
  assert.equal(errorEvent?.data?.error?.fatal, false);
  assert.equal(errorEvent?.data?.error?.code, "RECOVERABLE_TOOL_INVOKE_ERROR");
});

test("executeToolCall keeps a plain-object throw message non-empty", async () => {
  const result = await executeToolCall({
    call: { id: "call-plain-object", name: "demo_tool", args: {} },
    tool: {
      invoke: async () => {
        throw { reason: 1 };
      },
    },
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.code, "RECOVERABLE_TOOL_INVOKE_ERROR");
  assert.equal(payload.error, "[object Object]");
});

test("executeToolCall publishes mutationRefs for a committed file mutation", async () => {
  const result = await executeToolCall({
    call: { id: "call-mutation-ok", name: "write_file", args: {} },
    tool: { invoke: async () => JSON.stringify(committedMutationResult()) },
  });
  assert.equal(result.success, true);
  assert.equal(result.mutationRefs.length, 1);
  const [ref] = result.mutationRefs;
  assertMutationRef(ref);
  assert.equal(ref.mutationId, MUTATION_ID);
  assert.deepEqual(ref.locator, { view: "workspace", path: "src/example.js" });
  assert.equal(ref.snapshot, "available");
});

test("executeToolCall publishes no mutationRefs when the call fails", async () => {
  const okFalse = await executeToolCall({
    call: { id: "call-mutation-ok-false", name: "patch_file", args: {} },
    tool: {
      invoke: async () => JSON.stringify({ ...committedMutationResult(), ok: false }),
    },
  });
  assert.equal(okFalse.success, false);
  assert.deepEqual(okFalse.mutationRefs, []);

  const thrown = await executeToolCall({
    call: { id: "call-mutation-throw", name: "patch_file", args: {} },
    tool: {
      invoke: async () => {
        throw new Error("patch rolled back");
      },
    },
  });
  assert.equal(thrown.success, false);
  assert.deepEqual(thrown.mutationRefs, []);
});

test("canonical tool_call_end carries validated mutationRefs", async () => {
  const events = [];
  await executeToolCall({
    call: { id: "call-mutation-event", name: "write_file", args: {} },
    tool: { invoke: async () => JSON.stringify(committedMutationResult()) },
    runtime: createTestRuntimeContext({
      eventListener: { onEvent: (event) => events.push(event) },
    }),
  });
  const completed = findCommittedMessagePayload(events, "tool_call_end");
  assert.equal(completed?.success, true);
  assert.equal(completed.mutationRefs.length, 1);
  assertMutationRef(completed.mutationRefs[0]);
  assert.equal(completed.mutationRefs[0].mutationId, MUTATION_ID);
});

test("executeToolCall maps schema validation failures to RECOVERABLE_INVALID_INPUT", async () => {
  const { tool: structuredTool } = await import("@langchain/core/tools");
  const schemaTool = structuredTool(async () => "unreachable", {
    name: "demo_schema_tool",
    description: "demo",
    schema: z.object({ query: z.string().min(1) }),
  });
  const result = await executeToolCall({
    call: { id: "call-schema-invalid", name: "demo_schema_tool", args: { query: "" } },
    tool: schemaTool,
    turn: 1,
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "RECOVERABLE_INVALID_INPUT");
  assert.match(payload.error, /did not match expected schema/);
  assert.match(payload.error, /query/);
  assert.equal(result.success, false);
});
