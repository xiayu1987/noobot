/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  TOOL_INPUT_OVERFLOW_CHARS,
  assertTransferProtocolOnly,
  buildSandboxRuntime,
  compactToolResultTextForModel,
  directInput,
  directOutput,
  extractTransferEnvelopeFromPersisted,
  fileOutput,
  firstTransferFile,
  isTransferEnvelope,
  materializeOutput,
  normalizeTransfer,
  normalizeTransferEnvelopes,
  normalizeTransferEnvelopesWithPolicy,
  normalizeTransferReason,
  normalizeTransferSource,
  resolveTransferFilePath,
  resolveTransferIntent,
  resolveTransferPathView,
  transferSemanticContent,
} from "./helpers/semantic-transfer-helper.js";

test("transferSemanticContent returns transfer envelope for long tool input", async () => {
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    text: "x".repeat(64),
    inlineMaxChars: 10,
    runtime: {
      attachmentService: {
        async ingestGeneratedArtifacts(payload) {
          return payload.artifacts.map((artifact, index) => ({
            attachmentId: `tool-input-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: 64,
            path: `/host/${artifact.name}`,
            relativePath: `attachments/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          }));
        },
      },
      systemRuntime: { userId: "u1", sessionId: "s1" },
    },
  });
  assertTransferProtocolOnly(assert, transferred);
  assert.equal(transferred.transferEnvelopes?.[0]?.direction, "input");
  const file = firstTransferFile(transferred);
  assert.equal(file.attachmentMeta?.attachmentId, "tool-input-1");
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.exceeded, true);
});
test("transferSemanticContent tool_input decides call arg overflow inside semantic-transfer", async () => {
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "write_file",
      args: {
        filePath: "large.txt",
        content: "x".repeat(TOOL_INPUT_OVERFLOW_CHARS + 1),
      },
    },
    runtime: {
      attachmentService: {
        async ingestGeneratedArtifacts(payload) {
          return payload.artifacts.map((artifact, index) => ({
            attachmentId: `tool-call-input-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: TOOL_INPUT_OVERFLOW_CHARS + 1,
            path: `/host/${artifact.name}`,
            relativePath: `attachments/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          }));
        },
      },
      systemRuntime: { userId: "u1", sessionId: "s1" },
    },
  });

  assertTransferProtocolOnly(assert, transferred);
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.exceeded, true);
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.message, "文件内容过长，请分批写入");
  assert.equal(transferred.transferEnvelopes?.[0]?.direction, "input");
  assert.equal(firstTransferFile(transferred).name, "large.txt.tool-input.txt");
});
test("transferSemanticContent tool_input supports patch_file patch overflow", async () => {
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "patch_file",
      args: {
        format: "apply_patch",
        patch: "x".repeat(TOOL_INPUT_OVERFLOW_CHARS + 1),
      },
    },
    runtime: {
      attachmentService: {
        async ingestGeneratedArtifacts(payload) {
          return payload.artifacts.map((artifact, index) => ({
            attachmentId: `patch-input-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: TOOL_INPUT_OVERFLOW_CHARS + 1,
            path: `/host/${artifact.name}`,
            relativePath: `attachments/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          }));
        },
      },
      systemRuntime: { userId: "u1", sessionId: "s1" },
    },
  });

  assertTransferProtocolOnly(assert, transferred);
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.exceeded, true);
  assert.equal(transferred.transferEnvelopes?.[0]?.direction, "input");
  assert.equal(firstTransferFile(transferred).name, "patch-file-patch.tool-input.diff");
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.message, "补丁内容过长，请分批应用或拆分 patch 后重试");
});
test("transferSemanticContent tool_input forces task_summary summaryContent into attachment", async () => {
  const summaryContent = "阶段小结：已完成核心修改，继续验证。";
  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "task_summary",
      args: { summaryContent },
    },
    runtime: {
      attachmentService: {
        async ingestGeneratedArtifacts(payload) {
          return payload.artifacts.map((artifact, index) => ({
            attachmentId: `task-summary-input-${index + 1}`,
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
    },
  });

  assertTransferProtocolOnly(assert, transferred);
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.exceeded, false);
  assert.equal(transferred.transferEnvelopes?.[0]?.meta?.toolInputOverflow?.exceeded, false);
  assert.equal(transferred.transferEnvelopes?.[0]?.direction, "input");
  assert.equal(firstTransferFile(transferred).name, "task-summary-content.tool-input.md");
});
test("semantic-transfer read_file overflow returns original-file envelope without attachment metadata", async () => {
  const resolvedPath = "/workspace/project/large-read.txt";
  const content = "a".repeat(400);
  const result = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_result_text",
    call: { id: "call_read_overflow", name: "read_file" },
    runtime: {
      globalConfig: {
        tools: { maxToolResultChars: 120 },
      },
      userConfig: {},
    },
    toolResultText: JSON.stringify({
      toolName: "read_file",
      ok: true,
      resolvedPath,
      fileName: "large-read.txt",
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      includeLineNumbers: true,
      truncated: false,
      content,
    }),
  });

  const payload = JSON.parse(result.toolResultText);
  assert.equal(result.overflowed, true);
  assert.equal(payload.toolName, "read_file");
  assert.equal(payload.ok, true);
  assert.equal(payload.overflowed, true);
  assert.equal(payload.overflow_strategy, "original_file_reference");
  assert.equal(payload.content, undefined);
  assert.equal(payload.fileAddress, undefined);
  assert.equal(payload.resolvedPath, undefined);
  assert.equal(payload.content_omitted, undefined);
  assert.equal(payload.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(payload.transferEnvelopes?.[0]?.transport, "file");
  assert.equal("filePath" in payload.transferEnvelopes?.[0], false);
  assert.equal("pathView" in payload.transferEnvelopes?.[0], false);
  assert.equal(payload.transferEnvelopes?.[0]?.files?.[0]?.filePath, resolvedPath);
  assert.equal(payload.transferEnvelopes?.[0]?.storage?.originalFile, true);
  assert.equal(payload.transferEnvelopes?.[0]?.storage?.persisted, false);
  assert.equal(payload.transferEnvelopes?.[0]?.meta?.originalFile, true);
  assert.equal(payload.transferEnvelopes?.[0]?.meta?.contentOmitted, true);
  assert.equal(payload.transferEnvelopes?.[0]?.meta?.contentLength, content.length);
  assert.equal(payload.transferEnvelopes?.[0]?.attachmentMeta, undefined);
  assert.equal(payload.transferEnvelopes?.[0]?.files?.[0]?.attachmentMeta, undefined);
  assert.equal(payload.transferEnvelopes?.[0]?.files?.[0]?.filePath, resolvedPath);
  assert.equal(Array.isArray(payload.transferEnvelopes), true);
  assert.equal(payload.transferEnvelopes.length, 1);
});
