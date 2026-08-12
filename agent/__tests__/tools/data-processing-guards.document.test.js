/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDoc2DataTool,
  decodeLibreOfficeTextBuffer,
} from "../../src/tools/data-processing/doc2data-tool.js";
import {
  buildLibreOfficeTempPathTokensForNodePid,
  resolveLibreOfficeTempRoots,
} from "../../src/tools/data-processing/doc2data/libreoffice.js";
import {
  createMedia2DataTool,
  resolveMediaBinaryPath,
  runMediaProcess,
} from "../../src/tools/data-processing/media2data-tool.js";
import { createContentProcessTool } from "../../src/tools/data-processing/content-process-tool.js";
import { createWeb2DataTool } from "../../src/tools/data-processing/web2data-tool.js";
import { createConnectorAccessTool } from "../../src/tools/connectors/connector-access-tool.js";
import { ERROR_CODE } from "../../src/shared/errors/constants.js";
import { TOOL_NAME } from "../../src/tools/constants/index.js";
import { buildAgentContext, readJsonl } from "./data-processing-guards.test-helpers.js";

const TEST_TRANSFER_IDENTITY = Object.freeze({
  transferId: "transfer:test:doc2data:output",
  messageId: "message:test-doc2data",
  sessionId: "s1",
  turnScopeId: "turn:test-doc2data",
  runId: "run:test-doc2data",
  producer: { type: "tool", id: "call:test-doc2data" },
});

function invokeDoc(tool, args) {
  return tool.invoke(args, { configurable: { transferIdentity: TEST_TRANSFER_IDENTITY } });
}


test("doc_to_data: LibreOffice text output decoder handles Windows Chinese encodings", () => {
  const gbkBuffer = Buffer.from([
    0xd6, 0xd0, 0xce, 0xc4,
    0x0d, 0x0a,
    0xb2, 0xe2, 0xca, 0xd4,
  ]);

  assert.equal(decodeLibreOfficeTextBuffer(gbkBuffer), "中文\r\n测试");
});

test("doc_to_data: LibreOffice text output decoder keeps UTF-8 and strips BOM", () => {
  assert.equal(
    decodeLibreOfficeTextBuffer(Buffer.from("\uFEFF中文\n", "utf8")),
    "中文\n",
  );
});

test("doc_to_data: LibreOffice temp roots include macOS TMPDIR and /tmp fallback", () => {
  const originalTmpdir = process.env.TMPDIR;
  const originalTemp = process.env.TEMP;
  const originalTmp = process.env.TMP;
  try {
    process.env.TMPDIR = "/var/folders/aa/bb/T/";
    delete process.env.TEMP;
    delete process.env.TMP;

    const roots = resolveLibreOfficeTempRoots();
    assert.equal(roots.includes(path.resolve("/var/folders/aa/bb/T/")), true);
    assert.equal(roots.includes(path.resolve("/tmp")), true);

    const tokens = buildLibreOfficeTempPathTokensForNodePid(12345);
    assert.equal(tokens.includes(path.join(path.resolve("/var/folders/aa/bb/T/"), "soffice-12345-")), true);
    assert.equal(tokens.includes(path.join(path.resolve("/var/folders/aa/bb/T/"), "libreofficeConvert_-12345-")), true);
    assert.equal(tokens.includes(path.join(path.resolve("/tmp"), "soffice-12345-")), true);
    assert.equal(tokens.includes(path.join(path.resolve("/tmp"), "libreofficeConvert_-12345-")), true);
  } finally {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    if (originalTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = originalTemp;
    if (originalTmp === undefined) delete process.env.TMP;
    else process.env.TMP = originalTmp;
  }
});

test("doc_to_data: direct text result stores content in file and returns text when under limit", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-direct-"));
  const textPath = path.join(basePath, "runtime", "ops_workdir", "input.md");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "hello\n".repeat(500), "utf8");

  const attachmentService = {
    async ingestGeneratedArtifacts(payload = {}) {
      const outputDir = path.join(basePath, "runtime", "attach", "scoped", "s1", "model");
      await fs.mkdir(outputDir, { recursive: true });
      return Promise.all(
        (payload.artifacts || []).map(async (artifact, index) => {
          const outputPath = path.join(outputDir, `${index}-${artifact.name}`);
          await fs.writeFile(outputPath, Buffer.from(artifact.contentBase64 || "", "base64"));
          return {
            attachmentId: `att-${index + 1}`,
            sessionId: "s1",
            attachmentSource: "model",
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: (await fs.stat(outputPath)).size,
            path: outputPath,
            relativePath: path.relative(basePath, outputPath),
            generatedByModel: true,
            generationSource: payload.generationSource,
          };
        }),
      );
    },
  };
  const agentContext = buildAgentContext(basePath);
  agentContext.bindings.runtime.userId = "primary-user";
  agentContext.bindings.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.bindings.runtime.attachmentService = attachmentService;

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await invokeDoc(tool, { filePath: "runtime/ops_workdir/input.md" }));
  assert.equal(payload.ok, true);
  assert.equal(payload.text, "hello\n".repeat(500));
  assert.equal("textPreview" in payload, false);
  assert.equal(payload.textLength, 3000);
  assert.equal(payload.contentStoredInFile, true);
  assert.equal("transferEnvelopes" in payload, true);
  assert.equal(Array.isArray(payload.transferEnvelopes), true);
  assert.equal(payload.transferEnvelopes.length, 1);
});

test("doc_to_data: direct text result returns preview when over semantic-transfer limit", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-direct-preview-"));
  const textPath = path.join(basePath, "runtime", "ops_workdir", "large.md");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "large\n".repeat(500), "utf8");

  const attachmentService = {
    async ingestGeneratedArtifacts(payload = {}) {
      const outputDir = path.join(basePath, "runtime", "attach", "scoped", "s1", "model");
      await fs.mkdir(outputDir, { recursive: true });
      return Promise.all(
        (payload.artifacts || []).map(async (artifact, index) => {
          const outputPath = path.join(outputDir, `${index}-${artifact.name}`);
          await fs.writeFile(outputPath, Buffer.from(artifact.contentBase64 || "", "base64"));
          return {
            attachmentId: `large-att-${index + 1}`,
            sessionId: "s1",
            attachmentSource: "model",
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: (await fs.stat(outputPath)).size,
            path: outputPath,
            relativePath: path.relative(basePath, outputPath),
            generatedByModel: true,
            generationSource: payload.generationSource,
          };
        }),
      );
    },
  };
  const agentContext = buildAgentContext(basePath);
  agentContext.bindings.runtime.userId = "primary-user";
  agentContext.bindings.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.bindings.runtime.attachmentService = attachmentService;
  agentContext.bindings.runtime.globalConfig = { tools: { maxToolResultChars: 1000 } };

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await invokeDoc(tool, { filePath: "runtime/ops_workdir/large.md" }));
  assert.equal(payload.ok, true);
  assert.equal("text" in payload, false);
  assert.equal(typeof payload.textPreview, "string");
  assert.equal(payload.textPreview.length, 1200);
  assert.equal(payload.textPreviewTruncated, true);
  assert.equal(payload.textLength, 3000);
  assert.equal(payload.contentStoredInFile, true);
  assert.equal("transferEnvelopes" in payload, true);
  assert.equal(Array.isArray(payload.transferEnvelopes), true);
  assert.equal(payload.transferEnvelopes.length, 1);
});


test("doc_to_data: resolves a historical session attachment only after the model invokes parsing", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-backwrite-input-"));
  const textPath = path.join(basePath, "runtime", "ops_workdir", "source.md");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "source text\n".repeat(20), "utf8");

  const linkCalls = [];
  const attachmentService = {
    async resolveSourceAttachment(payload = {}) {
      assert.equal(payload.userId, "primary-user");
      assert.equal(payload.sessionId, "s1");
      assert.equal(payload.attachmentSource, "user");
      assert.equal(payload.attachmentId, "source-att");
      return {
        attachmentId: "source-att",
        sessionId: "s1",
        attachmentSource: "user",
        name: "source.md",
        mimeType: "text/markdown",
        size: (await fs.stat(textPath)).size,
        path: textPath,
        relativePath: path.relative(basePath, textPath),
        turnScope: { turnScopeId: "stopped-turn" },
      };
    },
    async ingestGeneratedArtifacts(payload = {}) {
      const outputDir = path.join(basePath, "runtime", "attach", "scoped", "s1", "model");
      await fs.mkdir(outputDir, { recursive: true });
      return Promise.all(
        (payload.artifacts || []).map(async (artifact, index) => {
          const outputPath = path.join(outputDir, `${index}-${artifact.name}`);
          await fs.writeFile(outputPath, Buffer.from(artifact.contentBase64 || "", "base64"));
          return {
            attachmentId: `parsed-${index + 1}`,
            sessionId: "s1",
            attachmentSource: "model",
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: (await fs.stat(outputPath)).size,
            path: outputPath,
            relativePath: path.relative(basePath, outputPath),
            generatedByModel: true,
            generationSource: payload.generationSource,
          };
        }),
      );
    },
    async linkParsedResultToAttachment(payload = {}) {
      linkCalls.push(payload);
      return {
        attachmentId: payload.sourceAttachmentId,
        sessionId: payload.sourceSessionId,
        attachmentSource: payload.sourceAttachmentSource,
        path: "",
        parsedResult: {
          attachmentId: payload.parsedAttachmentMeta?.attachmentId,
          path: payload.parsedAttachmentMeta?.path,
          relativePath: payload.parsedAttachmentMeta?.relativePath,
          tool: payload.toolName,
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      };
    },
  };
  const agentContext = buildAgentContext(basePath, {
    userId: "primary-user",
    systemRuntime: {
      sessionId: "s1",
      rootSessionId: "s1",
      dialogProcessId: "dialog-parent",
      turnScopeId: "continue-turn",
    },
  });
  const runtime = agentContext.bindings.runtime;
  const emittedEvents = [];
  runtime.eventListener = {
    onEvent(event) {
      emittedEvents.push(event);
    },
  };
  runtime.attachmentService = attachmentService;
  runtime.userMessageAttachments = [
    {
      attachmentId: "source-att",
      sessionId: "s1",
      attachmentSource: "user",
      name: "source.md",
      mimeType: "text/markdown",
      size: (await fs.stat(textPath)).size,
      path: textPath,
    },
  ];

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await invokeDoc(tool, {
    filePath: "runtime/ops_workdir/source.md",
    attachmentId: "source-att",
  }));
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.source_attachment_backwritten, true);
  assert.equal(linkCalls.length, 1);
  assert.equal(linkCalls[0]?.sourceAttachmentId, "source-att");
  assert.equal(linkCalls[0]?.sourceAttachmentSource, "user");
  assert.equal(linkCalls[0]?.sourceSessionId, "s1");
  assert.equal(linkCalls[0]?.parsedAttachmentMeta?.attachmentId, "parsed-1");
  assert.equal("sourceTurnScopeId" in linkCalls[0], false);
  assert.equal("requestedInTurnScopeId" in linkCalls[0], false);
  assert.equal(runtime.userMessageAttachments.length, 1);
  assert.equal(runtime.userMessageAttachments[0]?.attachmentId, "source-att");
  assert.equal(runtime.userMessageAttachments[0]?.parsedResult?.attachmentId, "parsed-1");
  const parsedEvent = emittedEvents.find((event) => event?.event === "attachment_parsed");
  assert.equal(parsedEvent?.data?.dialogProcessId, "dialog-parent");
  assert.equal(parsedEvent?.data?.turnScopeId, "continue-turn");
  assert.equal(parsedEvent?.data?.attachments?.[0]?.attachmentId, "source-att");
  assert.equal(parsedEvent?.data?.attachments?.[0]?.parsedResult?.attachmentId, "parsed-1");
});

test("doc_to_data: child run resolves source identity from the root session by attachment ID", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-child-source-"));
  const relativePath = path.join("runtime", "attach", "scoped", "root-session", "user", "source.md");
  const textPath = path.join(basePath, relativePath);
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "child source\n", "utf8");

  const resolveCalls = [];
  const linkCalls = [];
  const agentContext = buildAgentContext(basePath, {
    userId: "primary-user",
    systemRuntime: {
      sessionId: "child-session",
      parentSessionId: "root-session",
      rootSessionId: "root-session",
      dialogProcessId: "parent-dialog",
      turnScopeId: "parent-turn",
    },
  });
  const runtime = agentContext.bindings.runtime;
  runtime.attachmentService = {
    async resolveSourceAttachment(payload = {}) {
      resolveCalls.push(payload);
      return {
        attachmentId: "source-att",
        sessionId: "root-session",
        attachmentSource: "user",
        path: textPath,
        relativePath,
      };
    },
    async ingestGeneratedArtifacts(payload = {}) {
      return [{
        attachmentId: "parsed-att",
        sessionId: "root-session",
        attachmentSource: "model",
        path: path.join(basePath, "parsed.md"),
        relativePath: "parsed.md",
        name: payload.artifacts?.[0]?.name || "parsed.md",
      }];
    },
    async linkParsedResultToAttachment(payload = {}) {
      linkCalls.push(payload);
      return { attachmentId: payload.sourceAttachmentId, parsedResult: { attachmentId: "parsed-att" } };
    },
  };

  const tool = createDoc2DataTool({ agentContext })[0];
  const payload = JSON.parse(await invokeDoc(tool, {
    filePath: relativePath,
    attachmentId: "source-att",
  }));

  assert.equal(payload.summary.source_attachment_backwritten, true);
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0]?.sessionId, "root-session");
  assert.equal(resolveCalls[0]?.attachmentId, "source-att");
  assert.equal("filePath" in resolveCalls[0], false);
  assert.equal(linkCalls[0]?.sourceAttachmentId, "source-att");
});

test("doc_to_data: reuses generated data artifact instead of creating recursive copies", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-reuse-"));
  const textPath = path.join(basePath, "runtime", "attach", "scoped", "s1", "model", "existing.md");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "already parsed\n".repeat(200), "utf8");

  let persistCalls = 0;
  const agentContext = buildAgentContext(basePath);
  agentContext.bindings.runtime.userId = "primary-user";
  agentContext.bindings.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.bindings.runtime.userMessageAttachments = [
    {
      attachmentId: "existing-att",
      sessionId: "s1",
      attachmentSource: "model",
      name: "existing.md",
      mimeType: "text/markdown",
      size: (await fs.stat(textPath)).size,
      path: textPath,
      relativePath: path.relative(basePath, textPath),
      generatedByModel: true,
      generationSource: "media_to_data_tool",
    },
  ];
  agentContext.bindings.runtime.attachmentService = {
    async ingestGeneratedArtifacts() {
      persistCalls += 1;
      return [];
    },
  };

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await invokeDoc(tool, {
    filePath: path.relative(basePath, textPath),
    attachmentId: "existing-att",
  }));
  assert.equal(payload.ok, true);
  assert.equal(payload.reusedExistingArtifact, true);
  assert.equal(payload.text, "already parsed\n".repeat(200));
  assert.equal(payload.transferEnvelopes[0]?.version, 2);
  assert.equal(payload.transferEnvelopes[0]?.payload?.mode, "attachment");
  assert.equal(payload.transferEnvelopes[0]?.payload?.attachments?.[0]?.identity?.attachmentId, "existing-att");
  assert.equal(persistCalls, 0);
});

test("doc_to_data: image input should fail fast with unsupported file type", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-"));
  const imagePath = path.join(basePath, "runtime", "ops_workdir", "input.png");
  await fs.mkdir(path.dirname(imagePath), { recursive: true });
  await fs.writeFile(imagePath, "not-a-real-png", "utf8");

  const tools = createDoc2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ filePath: "runtime/ops_workdir/input.png" }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
  );
});

test("doc_to_data: libreoffice rejects legacy .doc before conversion", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-doc-"));
  const docPath = path.join(basePath, "runtime", "ops_workdir", "input.doc");
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));

  const tools = createDoc2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({
      filePath: "runtime/ops_workdir/input.doc",
    }),
    (error) => {
      assert.equal(error?.code, ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE);
      assert.match(error?.message || "", /\.doc/);
      return true;
    },
  );
});

test("doc_to_data: libreoffice abort propagates", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-abort-"));
  const docPath = path.join(basePath, "runtime", "ops_workdir", "input.docx");
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));

  const abortController = new AbortController();
  abortController.abort({ type: "user_stop" });
  const agentContext = buildAgentContext(basePath);
  agentContext.bindings.runtime.abortSignal = abortController.signal;

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({
      filePath: "runtime/ops_workdir/input.docx",
    }),
    (error) => {
      assert.equal(error?.name, "AbortError");
      assert.equal(error?.code, "ABORT_ERR");
      return true;
    },
  );
});

test("doc_to_data: libreoffice failure writes one runtime-events system event", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-runtime-events-"));
  const sessionDir = path.join(basePath, "u1", "runtime", "session", "s1");
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, "session.json"), JSON.stringify({ sessionId: "s1" }), "utf8");
  const docPath = path.join(basePath, "runtime", "ops_workdir", "input.docx");
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));

  const agentContext = buildAgentContext(basePath);
  const runtime = agentContext.bindings.runtime;
  runtime.userId = "u1";
  runtime.globalConfig = { workspaceRoot: basePath };
  runtime.systemRuntime = {
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
  };

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  await assert.rejects(() => tool.invoke({
    filePath: "runtime/ops_workdir/input.docx",
  }));

  const records = await readJsonl(path.join(
    basePath,
    "u1",
    "runtime",
    "session",
    "s1",
    "events",
    "system.jsonl",
  ));
  assert.equal(records.length, 1);
  const parseFailedRecord = records.find(
    (record) => record.event === "agent.doc2data.libreofficeParse.failed",
  );
  assert.ok(parseFailedRecord);
  for (const record of [parseFailedRecord]) {
    assert.equal(record.source, "agent");
    assert.equal(record.channel, "direct");
    assert.equal(record.category, "system");
    assert.equal(record.userId, "u1");
    assert.equal(record.sessionId, "s1");
    assert.equal(record.dialogProcessId, "dp1");
    assert.equal(record.turnScopeId, "turn1");
    assert.equal(record.data.inputFileName, "input.docx");
    assert.ok(Number(record.data.inputPathLength) > 0);
    assert.ok(String(record.data.errorMessage || ""));
    assert.equal(record.data.input, undefined);
    assert.equal(record.data.cause, undefined);
    assert.equal(record.data.stack, undefined);
  }
  assert.ok("timeoutMs" in parseFailedRecord.data);
  assert.ok("tempMaxBytes" in parseFailedRecord.data);
  assert.equal("libreOfficeBudget" in parseFailedRecord.data, false);
});
