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

test("persistTransferArtifacts saves through attachment service and returns transfer envelopes", async () => {
  const { getTransferAttachmentMetas } = await import("../../../src/system-core/semantic-transfer/index.js");
  const { persistTransferArtifacts } = await import("../../../src/system-core/semantic-transfer/storage/attachment-adapter.js");
  const calls = [];
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      calls.push(payload);
      return payload.artifacts.map((artifact, index) => ({
        attachmentId: `att-${index + 1}`,
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: 3,
        path: `/host/${artifact.name}`,
        relativePath: `attachments/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
    owner: {
      type: "turn",
      id: "turn-1",
      turnScope: {
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
        sessionId: "s1",
      },
    },
      }));
    },
  };
  const persisted = await persistTransferArtifacts({
    attachmentService,
    runtime: {
      systemRuntime: {
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
      },
    },
    userId: "u1",
    sessionId: "s1",
    attachmentSource: "model",
    generationSource: "unit_test",
    artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YWJj" }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].generationSource, "unit_test");
  assert.deepEqual(calls[0].turnScope, {
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    sessionId: "s1",
  });
  assert.equal("transferEnvelopes" in persisted, true);
  assert.equal("filePath" in persisted.transferEnvelopes?.[0], false);
  assert.equal(firstTransferFile(persisted).filePath, "attachments/a.txt");
  assertTransferProtocolOnly(assert, { transferEnvelopes: persisted.transferEnvelopes });
  assert.equal(getTransferAttachmentMetas(persisted.transferEnvelopes).length, 1);
  const [attachmentMeta] = getTransferAttachmentMetas(persisted.transferEnvelopes);
  assert.equal(attachmentMeta.attachmentId, "att-1");
  assert.equal(attachmentMeta.sessionId, "s1");
  assert.equal(attachmentMeta.attachmentSource, "model");
  assert.equal(attachmentMeta.mimeType, "text/plain");
  assert.equal(attachmentMeta.generationSource, "unit_test");
  assert.equal(attachmentMeta.owner.type, "turn");
  assert.equal(attachmentMeta.owner.id, "turn-1");
  assert.deepEqual(attachmentMeta.turnScope, {
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    sessionId: "s1",
  });
  assert.equal("attachmentMeta" in persisted.transferEnvelopes?.[0], false);
  assert.equal("pathView" in persisted.transferEnvelopes?.[0], false);
  assert.equal(persisted.transferEnvelopes?.[0]?.files?.[0]?.attachmentMeta?.attachmentId, attachmentMeta.attachmentId);
  assert.equal(persisted.transferEnvelopes?.[0]?.files?.[0]?.attachmentMeta?.sessionId, attachmentMeta.sessionId);
  assert.equal("attachmentMetas" in persisted, false);
  assert.equal("filePath" in persisted, false);
  assert.equal("filePaths" in persisted, false);
  assert.equal("result" in persisted, false);
  assert.equal("transferResult" in persisted, false);
  assert.equal("envelope" in persisted, false);
});
test("attachment metadata normalizes owner and turn scope shapes", async () => {
  const { mapAttachmentRecordsToMetas } = await import("../../../src/system-core/attach/index.js");
  const metas = mapAttachmentRecordsToMetas([
    {
      attachmentId: "canonical-owner",
      sessionId: "s-flat",
      attachmentSource: "model",
      name: "flat.txt",
      mimeType: "text/plain",
      owner: { type: "turn", id: "flat-turn" },
      turnScope: {
        turnScopeId: "flat-turn",
        dialogProcessId: "flat-dialog",
        sessionId: "s-flat",
      },
    },
    {
      attachmentId: "canonical-nested",
      sessionId: "s-nested",
      attachmentSource: "model",
      name: "nested.txt",
      mimeType: "text/plain",
      owner: {
        type: "tool",
        id: "tool-call-1",
      },
      turnScope: {
        turnScopeId: "nested-turn",
        dialogProcessId: "nested-dialog",
        sessionId: "s-nested",
      },
    },
  ]);

  assert.equal(metas[0].owner.type, "turn");
  assert.equal(metas[0].owner.id, "flat-turn");
  assert.deepEqual(metas[0].turnScope, {
    turnScopeId: "flat-turn",
    dialogProcessId: "flat-dialog",
    sessionId: "s-flat",
  });
  assert.equal(metas[1].owner.type, "tool");
  assert.equal(metas[1].owner.id, "tool-call-1");
  assert.deepEqual(metas[1].turnScope, {
    turnScopeId: "nested-turn",
    dialogProcessId: "nested-dialog",
    sessionId: "s-nested",
  });
});
test("persistTransferArtifacts returns skipped result and empty transfer fields when service missing", async () => {
  const { persistTransferArtifacts } = await import("../../../src/system-core/semantic-transfer/storage/attachment-adapter.js");
  const persisted = await persistTransferArtifacts({
    userId: "u1",
    sessionId: "s1",
    artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" }],
  });
  assert.deepEqual(persisted.transferEnvelopes, []);
  assert.equal("attachmentMetas" in persisted, false);
  assert.equal("filePath" in persisted, false);
  assert.equal("filePaths" in persisted, false);
  assert.equal("result" in persisted, false);
  assert.equal("transferResult" in persisted, false);
  assert.equal("envelope" in persisted, false);
});
test("persistTransferArtifacts returns rich transfer envelope for multi artifacts", async () => {
  const { getTransferAttachmentMetas } = await import("../../../src/system-core/semantic-transfer/index.js");
  const { persistTransferArtifacts } = await import("../../../src/system-core/semantic-transfer/storage/attachment-adapter.js");
  const attachmentService = {
    async ingestGeneratedArtifacts(payload) {
      return payload.artifacts.map((artifact, index) => ({
        attachmentId: `att-rich-${index + 1}`,
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: 3,
        path: `/host/${artifact.name}`,
        relativePath: `attachments/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };
  const persisted = await persistTransferArtifacts({
    attachmentService,
    userId: "u1",
    sessionId: "s1",
    attachmentSource: "model",
    generationSource: "rich_test",
    source: "tool",
    producer: { type: "tool", name: "rich" },
    artifacts: [
      { name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" },
      { name: "b.txt", mimeType: "text/plain", contentBase64: "Yg==" },
    ],
  });
  assert.equal("filePath" in persisted.transferEnvelopes[0], false);
  assert.equal("attachmentMeta" in persisted.transferEnvelopes[0], false);
  assert.equal("pathView" in persisted.transferEnvelopes[0], false);
  assert.equal(persisted.transferEnvelopes[0].files[0].filePath, "attachments/a.txt");
  assert.equal(persisted.transferEnvelopes[0].files.length, 2);
  assert.equal(getTransferAttachmentMetas(persisted.transferEnvelopes).length, 2);
  assert.equal(persisted.transferEnvelopes[0].storage.kind, "attachment");
  assert.equal(persisted.transferEnvelopes[0].storage.generationSource, "rich_test");
  assert.equal(persisted.transferEnvelopes[0].meta.producer.name, "rich");
  assert.equal("attachmentMetas" in persisted, false);
  assert.equal("filePath" in persisted, false);
  assert.equal("filePaths" in persisted, false);
});
