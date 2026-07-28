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

test("transferSemanticContent keeps bot_plugin sub-agent transfer output focused on conversion", async () => {
  const transferred = await transferSemanticContent({
    scenario: "bot_plugin",
    strategy: "bot_plugin_subagent_result",
    runtime: {
      attachmentService: {
        async ingestGeneratedArtifacts(payload) {
          return payload.artifacts.map((artifact, index) => ({
            attachmentId: `${artifact.name}-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: 12,
            path: `/host/${artifact.name}`,
            relativePath: `attachments/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          }));
        },
      },
      systemRuntime: { userId: "u1", sessionId: "s1" },
    },
    messages: [
      { nodeId: "a", nodeName: "A", content: "result-a" },
      { nodeId: "b", nodeName: "B", content: "result-b" },
    ],
    nextSteps: [{ nodeId: "c" }, { nodeId: "d" }],
  });
  assert.equal(Array.isArray(transferred.transferEnvelopes), true);
  assert.equal(transferred.transferEnvelopes.length, 2);
  assert.equal("downstreamInjections" in transferred, false);
});
test("transferSemanticContent produces agent_plugin stage refs and final output", async () => {
  const staged = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_stage_message",
    runtime: {
      attachmentService: {
        async ingestGeneratedArtifacts(payload) {
          return payload.artifacts.map((artifact, index) => ({
            attachmentId: `stage-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: 16,
            path: `/host/${artifact.name}`,
            relativePath: `attachments/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          }));
        },
      },
      systemRuntime: { userId: "u1", sessionId: "s1" },
    },
    summary: "done",
    detail: "long detail",
  });
  assertTransferProtocolOnly(assert, staged);
  assert.equal(staged.transferEnvelopes?.[0]?.meta?.summary, "done");
  assert.equal(staged.transferEnvelopes?.[0]?.transport, "file");
  const finalTransferred = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_final_message",
    resultInfo: "最终结果",
    detailRefs: staged.transferEnvelopes?.[0]?.files || [],
    validationInfo: "验收通过",
  });
  assertTransferProtocolOnly(assert, finalTransferred);
  assert.equal(finalTransferred.transferEnvelopes?.[0]?.content.includes("最终结果"), true);
  assert.equal(finalTransferred.transferEnvelopes?.[0]?.content.includes("验收通过"), true);
});
