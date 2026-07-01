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

test("compactToolResultTextForModel replaces verbose transfer payload with concise transferFiles", () => {
  const attachmentMeta = {
    attachmentId: "att_1",
    sessionId: "s1",
    attachmentSource: "model",
    name: "generated.png",
    mimeType: "image/png",
    size: 123,
    path: "/host/generated.png",
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
    files: [
      {
        filePath: "/workspace/generated.png",
        attachmentMeta,
        pathView: {
          displayPath: "/workspace/generated.png",
          hostPath: "/host/generated.png",
          relativePath: "runtime/attach/scoped/s1/model/generated.png",
        },
      },
    ],
  };
  const compacted = JSON.parse(
    compactToolResultTextForModel(
      JSON.stringify({
        toolName: "multimodal_generate",
        ok: true,
        attachmentMetas: [attachmentMeta],
        transferEnvelopes: [envelope],
      }),
    ),
  );

  assert.equal("transferResult" in compacted, false);
  assert.equal("transferEnvelopes" in compacted, false);
  assert.equal("attachmentMetas" in compacted, false);
  assert.deepEqual(COMPACT_TRANSFER_PAYLOAD_FIELDS, ["transferFiles"]);
  assert.equal(compacted.transferFiles.length, 1);
  assert.equal(compacted.transferFiles[0].attachmentId, "att_1");
  assert.equal(compacted.transferFiles[0].path, undefined);
  assert.deepEqual(
    Object.keys(compacted.transferFiles[0]).filter((field) => !COMPACT_TRANSFER_FILE_FIELDS.includes(field)),
    [],
  );
});
test("consumer helpers read envelope files and attachment metas", async () => {
  const {
    createTransferEnvelope,
    getTransferAttachmentMetas,
    getTransferDisplayPath,
    getTransferFiles,
  } = await import("../../../src/system-core/semantic-transfer/index.js");
  const envelope = createTransferEnvelope({
    transport: "file",
    files: [
      {
        filePath: "/workspace/a.md",
        attachmentMeta: { attachmentId: "a", path: "/host/a.md" },
        pathView: { displayPath: "/workspace/a.md", hostPath: "/host/a.md" },
      },
      {
        filePath: "/workspace/b.md",
        attachmentMeta: { attachmentId: "b", path: "/host/b.md" },
        pathView: { displayPath: "/workspace/b.md", hostPath: "/host/b.md" },
      },
    ],
  });
  assert.equal(getTransferFiles(envelope).length, 2);
  assert.equal(getTransferDisplayPath(envelope), "/workspace/a.md");
  assert.deepEqual(
    getTransferAttachmentMetas(envelope).map((item) => item.attachmentId),
    ["a", "b"],
  );

  const wrapped = {
    transferEnvelopes: [envelope],
  };
  assert.equal(getTransferFiles(wrapped).length, 2);
  assert.deepEqual(
    getTransferAttachmentMetas(wrapped).map((item) => item.attachmentId),
    ["a", "b"],
  );

  assert.equal(
    getTransferFiles({ attachmentMetas: [{ attachmentId: "legacy-1", path: "/host/legacy.txt" }] }).length,
    0,
  );
  assert.equal(
    getTransferAttachmentMetas({ attachmentMetas: [{ attachmentId: "legacy-1" }] }).length,
    0,
  );

  const events = [];
  const runtime = {
    eventListener: {
      onEvent(evt = {}) {
        events.push(evt);
      },
    },
  };
  getTransferFiles(
    { attachmentMetas: [{ attachmentId: "legacy-1", path: "/host/legacy.txt" }] },
    { runtime },
  );
  getTransferAttachmentMetas(
    { attachmentMetas: [{ attachmentId: "legacy-1" }] },
    { runtime },
  );
  const warnings = events.filter((evt = {}) => evt?.event === "semantic_transfer_legacy_input_warning");
  assert.equal(warnings.length >= 2, true);
  assert.equal(warnings[0]?.data?.message.includes("no longer supported"), true);
});
test("consumer helpers read compact transfer file refs", async () => {
  const {
    getTransferAttachmentMetas,
    getTransferDisplayPath,
    getTransferFiles,
  } = await import("../../../src/system-core/semantic-transfer/index.js");
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files: [
      {
        attachmentId: "compact-a",
        name: "a.md",
        path: "/workspace/a.md",
        sandboxPath: "/sandbox/a.md",
        owner: { type: "plugin", id: "harness-plugin" },
      },
    ],
  };

  assert.equal(getTransferFiles(envelope).length, 1);
  assert.equal(getTransferDisplayPath(envelope), "/workspace/a.md");
  const [meta] = getTransferAttachmentMetas(envelope);
  assert.equal(meta.attachmentId, "compact-a");
  assert.equal(meta.owner.type, "plugin");
});
