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
  assert.equal("filePath" in output, false);
  assert.equal(output.files?.[0]?.filePath, "/tmp/result.md");
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
    files: [{ filePath: "/workspace/a.txt" }],
  };
  const persisted = { transferEnvelopes: [validEnvelope] };
  assert.deepEqual(extractTransferEnvelopeFromPersisted(persisted), validEnvelope);

  const normalized = normalizeTransferEnvelopes([
    null,
    {},
    { filePath: "" },
    validEnvelope,
    { files: [{ filePath: "/workspace/b.txt" }] },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].files[0].filePath, "/workspace/a.txt");

  const validated = normalizeTransferEnvelopesWithPolicy(
    [validEnvelope, { filePath: "/workspace/legacy.txt" }],
    { enforceProtocol: true, withStats: true },
  );
  assert.equal(validated.envelopes.length, 1);
  assert.equal(validated.envelopes[0].files[0].filePath, "/workspace/a.txt");
  assert.equal(validated.stats.invalidCount, 1);
  assert.throws(
    () =>
      normalizeTransferEnvelopesWithPolicy(
        [{ filePath: "/workspace/legacy.txt" }],
        { enforceProtocol: true, strict: true },
      ),
    /invalid transfer envelopes/i,
  );
});
test("normalizeTransfer no longer maps legacy path objects to file envelopes", () => {
  const envelope = normalizeTransfer({ path: "/tmp/result.md", name: "result.md" });
  assert.equal(envelope.transport, "direct");
  assert.equal("files" in envelope, false);
});
test("file envelope supports files, pathView, storage and producer", () => {
  const envelope = fileOutput("/workspace/a.md", { name: "a.md", path: "/host/a.md" }, {
    source: "plugin",
    producer: { type: "plugin", id: "p1" },
  });
  assert.equal(envelope.transport, "file");
  assert.equal(envelope.meta.producer.id, "p1");

  const rich = normalizeTransfer({
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files: [
      {
        filePath: "attachments/a.md",
        attachmentMeta: { name: "a.md", path: "/host/a.md", relativePath: "attachments/a.md", mimeType: "text/markdown", size: 10 },
        pathView: { relativePath: "attachments/a.md", hostPath: "/host/a.md" },
        role: "primary",
      },
      {
        filePath: "attachments/b.md",
        attachmentMeta: { name: "b.md", path: "/host/b.md", relativePath: "attachments/b.md", mimeType: "text/markdown", size: 20 },
        pathView: { relativePath: "attachments/b.md", hostPath: "/host/b.md" },
        role: "secondary",
      },
    ],
    storage: { kind: "attachment", generationSource: "unit_test" },
    meta: { source: "tool", producer: { type: "tool", name: "unit" } },
  });
  assert.equal(rich.transport, "file");
  assert.equal("filePath" in rich, false);
  assert.equal("attachmentMeta" in rich, false);
  assert.equal(rich.files[0].filePath, "attachments/a.md");
  assert.equal(rich.files[0].attachmentMeta.name, "a.md");
  assert.equal(rich.files.length, 2);
  assert.equal(rich.files[0].role, "primary");
  assert.equal(rich.files[1].role, "secondary");
  assert.equal("pathView" in rich, false);
  assert.equal(rich.files[0].pathView.relativePath, "attachments/a.md");
  assert.equal(rich.storage.generationSource, "unit_test");
  assert.equal(rich.meta.producer.name, "unit");
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
  assertTransferProtocolOnly(assert, result);
  const validationEvent = events.find((evt = {}) => evt?.event === "semantic_transfer_validation");
  assert.equal(Boolean(validationEvent), true);
  assert.equal(validationEvent?.data?.scenario, "tool_output");
  assert.equal(validationEvent?.data?.outputCount >= 1, true);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].phase, "semantic_transfer");
});
