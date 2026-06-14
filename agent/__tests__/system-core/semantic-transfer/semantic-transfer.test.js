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
  compactToolResultTextForModel,
  directInput,
  directOutput,
  extractTransferEnvelopeFromPersisted,
  fileOutput,
  isTransferEnvelope,
  normalizeTransferEnvelopes,
  normalizeTransferEnvelopesWithPolicy,
  normalizeTransferReason,
  normalizeTransferSource,
  normalizeTransfer,
  resolveTransferIntent,
  resolveTransferFilePath,
  transferSemanticContent,
  resolveTransferPathView,
} from "../../../src/system-core/semantic-transfer/index.js";
import { materializeOutput } from "../../../src/system-core/semantic-transfer/storage/materializer.js";

test("semantic transfer envelopes keep direct/file semantics", () => {
  const input = directInput("hello", { source: "user" });
  assert.equal(isTransferEnvelope(input), true);
  assert.equal(input.direction, "input");
  assert.equal(input.transport, "direct");
  assert.equal(input.content, "hello");

  const output = fileOutput("/tmp/result.md", { name: "result.md" }, { source: "tool" });
  assert.equal(isTransferEnvelope(output), true);
  assert.equal(output.direction, "output");
  assert.equal(output.transport, "file");
  assert.equal(output.filePath, "/tmp/result.md");
});

test("intent helpers normalize source/reason/generationSource with aliases", () => {
  assert.equal(normalizeTransferSource("child_agent"), "subagent");
  assert.equal(normalizeTransferReason("transfer_output"), "semantic_transfer_output");
  const resolved = resolveTransferIntent({
    source: "bot_plugin",
    reason: "",
    generationSource: "",
  });
  assert.equal(resolved.source, "plugin");
  assert.equal(resolved.reason, "semantic_transfer_output");
  assert.equal(resolved.generationSource, "semantic_transfer_output");
});

test("envelope helpers normalize persisted output and filter invalid envelopes", () => {
  const validEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/a.txt",
  };
  const persisted = { result: { envelope: validEnvelope } };
  assert.deepEqual(extractTransferEnvelopeFromPersisted(persisted), validEnvelope);

  const normalized = normalizeTransferEnvelopes([
    null,
    {},
    { filePath: "" },
    validEnvelope,
    { files: [{ filePath: "/workspace/b.txt" }] },
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].filePath, "/workspace/a.txt");
  assert.equal(Array.isArray(normalized[1].files), true);

  const validated = normalizeTransferEnvelopesWithPolicy(
    [validEnvelope, { filePath: "/workspace/legacy.txt" }],
    { enforceProtocol: true },
  );
  assert.equal(validated.length, 1);
  assert.equal(validated[0].filePath, "/workspace/a.txt");
  assert.throws(
    () =>
      normalizeTransferEnvelopesWithPolicy(
        [{ filePath: "/workspace/legacy.txt" }],
        { enforceProtocol: true, strict: true },
      ),
    /invalid transfer envelopes/i,
  );
});

test("resolveTransferFilePath preserves sandboxPath priority and fallback path", () => {
  assert.equal(
    resolveTransferFilePath({ attachmentMeta: { sandboxPath: "/workspace/a.md", path: "/host/a.md" } }),
    "/workspace/a.md",
  );
  assert.equal(
    resolveTransferFilePath({ attachmentMeta: { relativePath: "attachments/a.md", name: "a.md" } }),
    "attachments/a.md",
  );
});

test("resolveTransferPathView keeps sandboxPath semantic separate from relative display fallback", () => {
  assert.deepEqual(
    resolveTransferPathView({ attachmentMeta: { relativePath: "attachments/a.md", name: "a.md" } }),
    {
      displayPath: "attachments/a.md",
      relativePath: "attachments/a.md",
    },
  );
  assert.equal(
    resolveTransferPathView({
      attachmentMeta: {
        sandboxPath: "/workspace/a.md",
        relativePath: "attachments/a.md",
        name: "a.md",
      },
    }).sandboxPath,
    "/workspace/a.md",
  );
});

test("resolveTransferFilePath tolerates resolver errors and keeps fallback behavior", () => {
  assert.equal(
    resolveTransferFilePath({
      runtime: {
        sharedTools: {
          resolveAttachmentDisplayPath() {
            throw new Error("display resolver failed");
          },
          resolveSandboxPath() {
            return "/workspace/a.md";
          },
        },
      },
      attachmentMeta: { path: "/host/a.md", relativePath: "attachments/a.md" },
    }),
    "/workspace/a.md",
  );
});

test("materializeOutput returns direct for small content and falls back direct when no persister", async () => {
  const small = await materializeOutput({ content: "short", maxDirectChars: 10 });
  assert.equal(small.transport, "direct");
  assert.equal(small.content, "short");

  const largeWithoutService = await materializeOutput({ content: "0123456789", maxDirectChars: 3 });
  assert.equal(largeWithoutService.transport, "direct");
  assert.equal(largeWithoutService.content, "0123456789");
  assert.equal(largeWithoutService.meta.materializeFallback, "direct");
});

test("normalizeTransfer maps paths to file envelopes", () => {
  const envelope = normalizeTransfer({ path: "/tmp/result.md", name: "result.md" });
  assert.equal(envelope.transport, "file");
  assert.equal(envelope.filePath, "/tmp/result.md");
});

test("transferSemanticContent dispatches by scenario", async () => {
  const toolTransferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_output",
    text: "small text",
  });
  assert.equal(toolTransferred?.transferResult?.ok, true);
  assert.equal(toolTransferred?.transferEnvelopes?.[0]?.transport, "direct");

  const stageTransferred = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_stage_message",
    summary: "ok",
    detail: "",
  });
  assert.equal(stageTransferred?.summary, "ok");
  assert.equal(stageTransferred?.transferResult?.status, "skipped");

  const finalTransferred = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_final_message",
    resultInfo: "done",
    detailRefs: [],
    validationInfo: "pass",
  });
  assert.equal(finalTransferred?.transferResult?.ok, true);
  assert.equal(finalTransferred.finalMessage.includes("done"), true);
  assert.equal(finalTransferred.finalMessage.includes("pass"), true);
});

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
    parsedResultAttachmentId: "",
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
        transferResult: { ok: true, status: "file", envelope },
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
      }));
    },
  };
  const persisted = await persistTransferArtifacts({
    attachmentService,
    userId: "u1",
    sessionId: "s1",
    attachmentSource: "model",
    generationSource: "unit_test",
    artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YWJj" }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].generationSource, "unit_test");
  assert.equal(persisted.transferResult?.status, "file");
  assert.equal(persisted.transferEnvelopes?.[0]?.filePath, "attachments/a.txt");
  assert.equal(getTransferAttachmentMetas(persisted.transferEnvelopes).length, 1);
  assert.equal(getTransferAttachmentMetas(persisted.transferEnvelopes)[0].attachmentId, "att-1");
  assert.equal("attachmentMetas" in persisted, false);
  assert.equal("filePath" in persisted, false);
  assert.equal("filePaths" in persisted, false);
});

test("persistTransferArtifacts returns skipped result and empty transfer fields when service missing", async () => {
  const { persistTransferArtifacts } = await import("../../../src/system-core/semantic-transfer/storage/attachment-adapter.js");
  const persisted = await persistTransferArtifacts({
    userId: "u1",
    sessionId: "s1",
    artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" }],
  });
  assert.equal(persisted.result?.status, "skipped");
  assert.deepEqual(persisted.transferEnvelopes, []);
  assert.equal("attachmentMetas" in persisted, false);
  assert.equal("filePath" in persisted, false);
  assert.equal("filePaths" in persisted, false);
});

test("file envelope supports files, pathView, storage and producer", () => {
  const envelope = fileOutput("/workspace/a.md", { name: "a.md", path: "/host/a.md" }, {
    source: "plugin",
    producer: { type: "plugin", id: "p1" },
  });
  assert.equal(envelope.transport, "file");
  assert.equal(envelope.meta.producer.id, "p1");

  const rich = normalizeTransfer({
    attachmentMetas: [
      { name: "a.md", path: "/host/a.md", relativePath: "attachments/a.md", mimeType: "text/markdown", size: 10 },
      { name: "b.md", path: "/host/b.md", relativePath: "attachments/b.md", mimeType: "text/markdown", size: 20 },
    ],
    storage: { kind: "attachment", generationSource: "unit_test" },
    producer: { type: "tool", name: "unit" },
    meta: { source: "tool" },
  });
  assert.equal(rich.transport, "file");
  assert.equal(rich.filePath, "attachments/a.md");
  assert.equal(rich.attachmentMeta.name, "a.md");
  assert.equal(rich.files.length, 2);
  assert.equal(rich.files[0].role, "primary");
  assert.equal(rich.files[1].role, "secondary");
  assert.equal(rich.pathView.relativePath, "attachments/a.md");
  assert.equal(rich.storage.generationSource, "unit_test");
  assert.equal(rich.meta.producer.name, "unit");
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
  assert.equal(persisted.transferEnvelopes[0].filePath, "attachments/a.txt");
  assert.equal(persisted.transferEnvelopes[0].files.length, 2);
  assert.equal(getTransferAttachmentMetas(persisted.transferEnvelopes).length, 2);
  assert.equal(persisted.transferEnvelopes[0].storage.kind, "attachment");
  assert.equal(persisted.transferEnvelopes[0].storage.generationSource, "rich_test");
  assert.equal(persisted.transferEnvelopes[0].meta.producer.name, "rich");
  assert.equal("attachmentMetas" in persisted, false);
  assert.equal("filePath" in persisted, false);
  assert.equal("filePaths" in persisted, false);
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
    filePath: "/workspace/a.md",
    attachmentMeta: { attachmentId: "a", path: "/host/a.md" },
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
    transferResult: { ok: true, status: "file", envelope },
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

test("transferSemanticContent returns compact transfer payload for long tool input", async () => {
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
  assert.equal(transferred.transferResult?.status, "file");
  assert.equal(transferred.transferEnvelopes?.[0]?.direction, "input");
  assert.equal(Array.isArray(transferred.compactToolPayload?.transferFiles), true);
  assert.equal(transferred.compactToolPayload.transferFiles[0].attachmentId, "tool-input-1");
});

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
  assert.equal(staged.summary, "done");
  assert.equal(staged.transferResult?.status, "file");
  const finalTransferred = await transferSemanticContent({
    scenario: "agent_plugin",
    strategy: "agent_plugin_final_message",
    resultInfo: "最终结果",
    detailRefs: staged.compactTransferPayload?.transferFiles || [],
    validationInfo: "验收通过",
  });
  assert.equal(finalTransferred.finalMessage.includes("最终结果"), true);
  assert.equal(finalTransferred.finalMessage.includes("验收通过"), true);
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
  assert.equal(fromBase64.result.status, "file");
  assert.equal(fromBase64.transferEnvelopes?.[0]?.filePath, "attachments/a.bin");
  assert.equal(calls[0].artifacts[0].contentBase64, "AQID");
  assert.equal("attachmentMetas" in fromBase64, false);
  assert.equal("filePath" in fromBase64, false);
  assert.equal("filePaths" in fromBase64, false);

  const fromBytes = await persistTransferFile({
    attachmentService,
    userId: "u1",
    sessionId: "s1",
    name: "b.bin",
    bytes: new Uint8Array([4, 5, 6]),
  });
  assert.equal(fromBytes.result.status, "file");
  assert.equal(calls[1].artifacts[0].contentBase64, "BAUG");
});

test("validateTransferEnvelope reports invalid and accepts valid envelopes", async () => {
  const { directOutput, fileOutput, validateTransferEnvelope, isValidTransferEnvelope } = await import("../../../src/system-core/semantic-transfer/index.js");
  assert.equal(isValidTransferEnvelope(directOutput("ok")), true);
  assert.equal(isValidTransferEnvelope(fileOutput("/tmp/a.txt", { path: "/tmp/a.txt" })), true);
  const invalid = validateTransferEnvelope({ protocol: "x" });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length > 0);
});

test("semantic-transfer emits validation event and hook", async () => {
  const { createAgentHookManager, AGENT_HOOK_POINTS } = await import("../../../src/system-core/hook/index.js");
  const events = [];
  const hooks = [];
  const hookManager = createAgentHookManager();
  hookManager.on(AGENT_HOOK_POINTS.SEMANTIC_TRANSFER_VALIDATION, async (ctx = {}) => {
    hooks.push(ctx);
  });
  const runtime = {
    hookManager,
    eventListener: {
      onEvent(evt = {}) {
        events.push(evt);
      },
    },
    globalConfig: { semanticTransfer: { strictEnvelopeValidation: false } },
    userConfig: {},
  };
  const result = await transferSemanticContent({
    runtime,
    scenario: "tool",
    strategy: "tool_output",
    text: "validation",
    inlineMaxChars: 1024,
  });
  assert.equal(result.transferValidation.outputCount >= 1, true);
  const validationEvent = events.find((evt = {}) => evt?.event === "semantic_transfer_validation");
  assert.equal(Boolean(validationEvent), true);
  assert.equal(validationEvent?.data?.scenario, "tool_output");
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].phase, "semantic_transfer");
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
  assert.equal(payload.transferEnvelopes?.[0]?.filePath, resolvedPath);
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
