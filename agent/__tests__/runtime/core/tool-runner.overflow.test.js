/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import {
  attachmentEnvelope,
  executeToolCall,
  findTransferEnvelopeByReason,
  getPrimaryTransferAttachment,
} from "./tool-runner.test-helpers.js";
import { AttachmentService } from "../../../src/artifacts/service/attachment-service.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

function withAttachmentService(options) {
  return createTestRuntimeContext({
    ...options,
    attachmentService: new AttachmentService(options.globalConfig),
  });
}

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
    identity: {
      userId: "user-call_overflow",
      sessionId: "session-overflow-1",
      rootSessionId: "session-overflow-1",
      parentSessionId: "",
      dialogProcessId: "dialog-call_overflow",
      turnScopeId: "turn-call_overflow",
      runId: "run-call_overflow",
      presentationMessageId: "message-call_overflow",
    },
    tool,
    turn: 1,
    runtime: withAttachmentService({
      identity: {
        userId: "user-call_overflow",
        sessionId: "session-overflow-1",
        parentSessionId: "",
        dialogProcessId: "dialog-call_overflow",
        turnScopeId: "turn-call_overflow",
        caller: SESSION_CALLER.USER,
      },
      basePath,
      globalConfig: {
        workspaceRoot: basePath,
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
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, true);
  assert.equal(payload.overflowed, true);
  const overflowEnvelope = findTransferEnvelopeByReason(
    result.transferEnvelopes,
    "tool_result_overflow",
  );
  const overflowAttachment = getPrimaryTransferAttachment(overflowEnvelope);
  assert.equal(overflowEnvelope.version, TRANSFER_VERSION);
  assert.equal(overflowEnvelope.payload.mode, "attachment");
  assert.equal(overflowAttachment.identity.sessionId, "session-overflow-1");
  assert.equal(overflowAttachment.identity.attachmentSource, "model");
  assert.equal(overflowAttachment.name, "demo_tool.result.txt");
  assert.deepEqual(payload.attachmentRefs, [
    formatAttachmentIdentityRef(overflowAttachment.identity),
  ]);
  assert.equal(payload.transferEnvelopes, undefined);
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
    runtime: createTestRuntimeContext({
      basePath,
      globalConfig: { tools: { maxToolResultChars: 1000 } },
      userConfig: {},
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.overflowed, undefined);
  assert.deepEqual(payload.attachmentRefs, [
    formatAttachmentIdentityRef(getPrimaryTransferAttachment(result.transferEnvelopes[0]).identity),
  ]);
  assert.equal("transferResult" in payload, false);
  assert.equal("transferEnvelopes" in payload, false);
  assert.equal("attachmentMetas" in payload, false);
  assert.equal("transferFiles" in payload, false);
  assert.equal(
    getPrimaryTransferAttachment(result.transferEnvelopes[0]).identity.attachmentId,
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
    runtime: withAttachmentService({
      basePath,
      globalConfig: { workspaceRoot: basePath, tools: { maxToolResultChars: 120 } },
      userConfig: {},
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.overflowed, true);
  assert.equal(Array.isArray(payload.attachmentRefs), true);
  assert.equal(payload.attachmentRefs.length >= 1, true);
  assert.equal(payload.transferEnvelopes, undefined);
  assert.equal("extractedAttachments" in result, false);
  assert.equal(result.transferEnvelopes.length >= 1, true);
  const overflowEnvelope = findTransferEnvelopeByReason(
    result.transferEnvelopes,
    "tool_result_overflow",
  );
  assert.equal(overflowEnvelope.version, TRANSFER_VERSION);
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
  const runtime = createTestRuntimeContext({
    identity: {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "dialog-call_task_summary_transfer",
      turnScopeId: "turn-call_task_summary_transfer",
      caller: SESSION_CALLER.USER,
    },
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
  });

  const result = await executeToolCall({
    call,
    tool,
    runtime,
    identity: {
      userId: "u1",
      sessionId: "s1",
      rootSessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "dialog-call_task_summary_transfer",
      turnScopeId: "turn-call_task_summary_transfer",
      runId: "run-call_task_summary_transfer",
      presentationMessageId: "message-call_task_summary_transfer",
    },
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
  assert.equal(Array.isArray(payload.attachmentRefs), true);
  assert.equal(payload.transferEnvelopes, undefined);
  assert.equal(
    result.transferEnvelopes?.[0]?.payload?.attachments?.[0]?.name,
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
    runtime: withAttachmentService({
      basePath,
      globalConfig: {
        workspaceRoot: basePath,
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
      },
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.overflowed, true);
  const overflowEnvelope = findTransferEnvelopeByReason(
    result.transferEnvelopes,
    "tool_result_overflow",
  );
  assert.equal(Array.isArray(payload.attachmentRefs), true);
  assert.equal(payload.transferEnvelopes, undefined);
  assert.equal(overflowEnvelope.version, TRANSFER_VERSION);
  assert.equal(overflowEnvelope.payload.mode, "attachment");
  assert.equal(JSON.stringify(overflowEnvelope).includes("filePath"), false);
  assert.equal(JSON.stringify(overflowEnvelope).includes("sandboxPath"), false);
  assert.equal(JSON.stringify(overflowEnvelope).includes("hostPath"), false);
});
