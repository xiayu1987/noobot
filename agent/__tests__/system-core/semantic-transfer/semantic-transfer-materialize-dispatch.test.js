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

test("materializeOutput returns direct for small content and falls back direct when no persister", async () => {
  const small = await materializeOutput({ content: "short", maxDirectChars: 10 });
  assert.equal(small.transport, "direct");
  assert.equal(small.content, "short");

  const largeWithoutService = await materializeOutput({ content: "0123456789", maxDirectChars: 3 });
  assert.equal(largeWithoutService.transport, "direct");
  assert.equal(largeWithoutService.content, "0123456789");
  assert.equal(largeWithoutService.meta.materializeFallback, "direct");
});
test("transferSemanticContent dispatches by scenario", async () => {
  const toolTransferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_output",
    text: "small text",
  });
  assertTransferProtocolOnly(assert, toolTransferred);
  assert.equal(toolTransferred?.transferEnvelopes?.[0]?.transport, "direct");

  const stageTransferred = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_stage_message",
    summary: "ok",
    detail: "",
  });
  assertTransferProtocolOnly(assert, stageTransferred);
  assert.equal(stageTransferred?.transferEnvelopes?.length, 0);

  const finalTransferred = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_final_message",
    resultInfo: "done",
    detailRefs: [],
    validationInfo: "pass",
  });
  assertTransferProtocolOnly(assert, finalTransferred);
  assert.equal(finalTransferred?.transferEnvelopes?.[0]?.content.includes("done"), true);
  assert.equal(finalTransferred?.transferEnvelopes?.[0]?.content.includes("pass"), true);
});
test("semantic-transfer public index only exposes unified transfer entry for scenario wrappers", async () => {
  const mod = await import("../../../src/system-core/semantic-transfer/index.js");
  assert.equal("buildLegacyTransferCompat" in mod, false);
  assert.equal("buildLegacyOverflowFields" in mod, false);
  assert.equal("transferSemanticContent" in mod, true);
  assert.equal("transferSemanticContentSync" in mod, false);
  assert.equal("transferToolMessage" in mod, false);
  assert.equal("transferSubAgentMessages" in mod, false);
  assert.equal("processStageMessage" in mod, false);
  assert.equal("composeFinalMessage" in mod, false);
  assert.equal("persistTransferArtifacts" in mod, false);
  assert.equal("persistTransferFile" in mod, false);
  assert.equal("materializeOutput" in mod, false);
  assert.equal("materializeOutputResult" in mod, false);
});
test("materializeOutputResult returns TransferResult and honors policy", async () => {
  const { materializeOutput, materializeOutputResult } = await import("../../../src/system-core/semantic-transfer/storage/materializer.js");
  const directResult = await materializeOutputResult({
    content: "abcdef",
    policy: { prefer: "auto", maxDirectChars: 10 },
  });
  assert.equal(directResult.ok, true);
  assert.equal(directResult.status, "direct");
  assert.equal(directResult.envelope.content, "abcdef");

  const fallbackResult = await materializeOutputResult({
    content: "abcdef",
    policy: { prefer: "file", allowAttachmentPersist: false },
  });
  assert.equal(fallbackResult.status, "fallback_direct");
  assert.equal(fallbackResult.envelope.transport, "direct");
  assert.equal(fallbackResult.envelope.meta.materializeFallbackReason, "attachment_persist_disabled");

  const legacyEnvelope = await materializeOutput({ content: "abc" });
  assert.equal(legacyEnvelope.transport, "direct");
});
test("persistTransferFile accepts base64 and bytes and returns transfer envelope", async () => {
  const { persistTransferFile } = await import("../../../src/system-core/semantic-transfer/storage/attachment-adapter.js");
  const calls = [];
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      calls.push(payload);
      return payload.artifacts.map((artifact) => ({
        attachmentId: "bin-1",
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: Buffer.from(artifact.contentBase64, "base64").length,
        path: `/host/${artifact.name}`,
        relativePath: `attachments/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };

  const fromBase64 = await persistTransferFile({
    attachmentService,
    userId: "u1",
    sessionId: "s1",
    name: "a.bin",
    mimeType: "application/octet-stream",
    contentBase64: "AQID",
  });
  assert.equal("filePath" in fromBase64.transferEnvelopes?.[0], false);
  assert.equal(fromBase64.transferEnvelopes?.[0]?.files?.[0]?.filePath, "attachments/a.bin");
  assert.equal(calls[0].artifacts[0].contentBase64, "AQID");
  assert.equal("attachmentMetas" in fromBase64, false);
  assert.equal("filePath" in fromBase64, false);
  assert.equal("filePaths" in fromBase64, false);
  assert.equal("result" in fromBase64, false);
  assert.equal("transferResult" in fromBase64, false);
  assert.equal("envelope" in fromBase64, false);

  const fromBytes = await persistTransferFile({
    attachmentService,
    userId: "u1",
    sessionId: "s1",
    name: "b.bin",
    bytes: new Uint8Array([4, 5, 6]),
  });
  assert.equal("filePath" in fromBytes.transferEnvelopes?.[0], false);
  assert.equal(fromBytes.transferEnvelopes?.[0]?.files?.[0]?.filePath, "attachments/b.bin");
  assert.equal(calls[1].artifacts[0].contentBase64, "BAUG");
});
