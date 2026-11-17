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
    name: "demo_tool",
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
  assert.deepEqual(payload.transferEnvelopes, result.transferEnvelopes);
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
    name: "demo_tool",
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
  assert.deepEqual(payload.transferEnvelopes, result.transferEnvelopes);
  assert.equal("transferResult" in payload, false);
  assert.equal("transferEnvelopes" in payload, true);
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
    name: "multimodal_generate",
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
  assert.equal(Array.isArray(payload.transferEnvelopes), true);
  assert.equal(payload.transferEnvelopes.length >= 1, true);
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

test("executeToolCall: overflow result never exposes sandbox or host paths", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-sandbox-"));
  const tool = {
    name: "demo_tool",
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
  assert.deepEqual(payload.transferEnvelopes, result.transferEnvelopes);
  assert.equal(overflowEnvelope.version, TRANSFER_VERSION);
  assert.equal(overflowEnvelope.payload.mode, "attachment");
  assert.equal(JSON.stringify(overflowEnvelope).includes("filePath"), false);
  assert.equal(JSON.stringify(overflowEnvelope).includes("sandboxPath"), false);
  assert.equal(JSON.stringify(overflowEnvelope).includes("hostPath"), false);
});

test("executeToolCall: an overflowed failure keeps the original failure contract", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-tool-overflow-failure-"));
  const sessionIdentity = {
    userId: "user-call_overflow_failure",
    sessionId: "session-overflow-failure",
    parentSessionId: "",
    dialogProcessId: "dialog-call_overflow_failure",
    turnScopeId: "turn-call_overflow_failure",
  };
  const identity = {
    ...sessionIdentity,
    rootSessionId: "session-overflow-failure",
    runId: "run-call_overflow_failure",
    presentationMessageId: "message-call_overflow_failure",
  };
  const tool = {
    name: "demo_tool",
    invoke: async () =>
      JSON.stringify({
        toolName: "demo_tool",
        ok: false,
        code: "RECOVERABLE_DEMO_FAILURE",
        error: "demo failed",
        stderr: "e".repeat(500),
      }),
  };

  const result = await executeToolCall({
    call: { id: "call_overflow_failure", name: "demo_tool", args: {} },
    identity,
    tool,
    turn: 1,
    runtime: withAttachmentService({
      identity: { ...sessionIdentity, caller: SESSION_CALLER.USER },
      basePath,
      globalConfig: {
        workspaceRoot: basePath,
        tools: { maxToolResultChars: 120 },
        security: {
          executionIsolation: { mode: "sandbox", sandbox: { provider: "docker", scope: "global" } },
        },
      },
      userConfig: {},
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(payload.ok, false);
  assert.equal(payload.overflowed, true);
  assert.equal(payload.code, "RECOVERABLE_DEMO_FAILURE");
  assert.equal(payload.error, "demo failed");
  assert.equal(result.transferEnvelopes.length, 1);
});
