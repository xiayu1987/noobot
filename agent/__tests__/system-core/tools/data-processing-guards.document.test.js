import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  createDoc2DataTool,
  decodeLibreOfficeTextBuffer,
} from "../../../src/system-core/tools/data-processing/doc2data-tool.js";
import {
  buildLibreOfficeTempPathTokensForNodePid,
  resolveLibreOfficeTempRoots,
} from "../../../src/system-core/tools/data-processing/doc2data/libreoffice.js";
import {
  createMedia2DataTool,
  resolveMediaBinaryPath,
  runMediaProcess,
} from "../../../src/system-core/tools/data-processing/media2data-tool.js";
import { createContentProcessTool } from "../../../src/system-core/tools/data-processing/content-process-tool.js";
import { createWeb2DataTool } from "../../../src/system-core/tools/data-processing/web2data-tool.js";
import { createConnectorAccessTool } from "../../../src/system-core/tools/connectors/connector-access-tool.js";
import { ERROR_CODE } from "../../../src/system-core/error/constants.js";
import { TOOL_NAME } from "../../../src/system-core/tools/constants/index.js";

function buildAgentContext(basePath = "") {
  return {
    environment: {
      workspace: { basePath },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          globalConfig: {},
          userConfig: {},
          sharedTools: {},
        },
      },
    },
  };
}

async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}


test("doc_to_data: LibreOffice text output decoder handles Windows Chinese encodings", () => {
  const gbkBuffer = Buffer.from([
    0xd6, 0xd0, 0xce, 0xc4, // 中文
    0x0d, 0x0a,
    0xb2, 0xe2, 0xca, 0xd4, // 测试
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
  agentContext.execution.controllers.runtime.userId = "primary-user";
  agentContext.execution.controllers.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.execution.controllers.runtime.attachmentService = attachmentService;

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await tool.invoke({ filePath: "runtime/ops_workdir/input.md" }));
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
  agentContext.execution.controllers.runtime.userId = "primary-user";
  agentContext.execution.controllers.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.execution.controllers.runtime.attachmentService = attachmentService;
  agentContext.execution.controllers.runtime.globalConfig = { tools: { maxToolResultChars: 1000 } };

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await tool.invoke({ filePath: "runtime/ops_workdir/large.md" }));
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
      assert.equal(payload.filePath, textPath);
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
        path: payload.sourceAttachmentPath,
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
  const agentContext = buildAgentContext(basePath);
  const runtime = agentContext.execution.controllers.runtime;
  const emittedEvents = [];
  runtime.userId = "primary-user";
  runtime.systemRuntime = {
    sessionId: "s1",
    dialogProcessId: "dialog-parent",
    turnScopeId: "continue-turn",
  };
  runtime.eventListener = {
    onEvent(event) {
      emittedEvents.push(event);
    },
  };
  runtime.attachmentService = attachmentService;
  runtime.userMessageAttachments = [];
  runtime.attachments = [
    {
      attachmentId: "source-att",
      sessionId: "s1",
      attachmentSource: "model",
      name: "source.md",
      mimeType: "text/markdown",
      size: 1,
      path: path.join(basePath, "runtime", "attach", "scoped", "s1", "model", "tool-source.md"),
      generationSource: "tool_generated_bucket_should_not_be_user_source",
    },
  ];

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await tool.invoke({ filePath: "runtime/ops_workdir/source.md" }));
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.source_attachment_backwritten, true);
  assert.equal(linkCalls.length, 1);
  assert.equal(linkCalls[0]?.sourceAttachmentId, "source-att");
  assert.equal(linkCalls[0]?.sourceAttachmentSource, "user");
  assert.equal(linkCalls[0]?.sourceAttachmentPath, textPath);
  assert.equal(linkCalls[0]?.parsedAttachmentMeta?.attachmentId, "parsed-1");
  assert.equal(linkCalls[0]?.sourceTurnScopeId, "stopped-turn");
  assert.equal(linkCalls[0]?.requestedInTurnScopeId, "continue-turn");
  assert.equal(runtime.userMessageAttachments.length, 0);
  assert.equal(runtime.attachments[0]?.parsedResult, undefined);
  const parsedEvent = emittedEvents.find((event) => event?.event === "attachment_parsed");
  assert.equal(parsedEvent?.data?.dialogProcessId, "dialog-parent");
  assert.equal(parsedEvent?.data?.turnScopeId, "continue-turn");
  assert.equal(parsedEvent?.data?.attachments?.[0]?.attachmentId, "source-att");
  assert.equal(parsedEvent?.data?.attachments?.[0]?.parsedResult?.attachmentId, "parsed-1");
});

test("doc_to_data: child run resolves source identity from the root session and exact path", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-child-source-"));
  const relativePath = path.join("runtime", "attach", "scoped", "root-session", "user", "source.md");
  const textPath = path.join(basePath, relativePath);
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "child source\n", "utf8");

  const resolveCalls = [];
  const linkCalls = [];
  const agentContext = buildAgentContext(basePath);
  const runtime = agentContext.execution.controllers.runtime;
  runtime.userId = "primary-user";
  runtime.systemRuntime = {
    sessionId: "child-session",
    parentSessionId: "root-session",
    rootSessionId: "root-session",
    dialogProcessId: "parent-dialog",
    turnScopeId: "parent-turn",
  };
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
  const payload = JSON.parse(await tool.invoke({
    filePath: relativePath,
    attachmentId: "source-att.md",
  }));

  assert.equal(payload.summary.source_attachment_backwritten, true);
  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0]?.sessionId, "root-session");
  assert.equal(resolveCalls[0]?.attachmentId, "source-att.md");
  assert.equal(resolveCalls[0]?.filePath, textPath);
  assert.equal(linkCalls[0]?.sourceAttachmentId, "source-att");
});

test("doc_to_data: reuses generated data artifact instead of creating recursive copies", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-reuse-"));
  const textPath = path.join(basePath, "runtime", "attach", "scoped", "s1", "model", "existing.md");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "already parsed\n".repeat(200), "utf8");

  let persistCalls = 0;
  const agentContext = buildAgentContext(basePath);
  agentContext.execution.controllers.runtime.userId = "primary-user";
  agentContext.execution.controllers.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.execution.controllers.runtime.attachments = [
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
  agentContext.execution.controllers.runtime.attachmentService = {
    async ingestGeneratedArtifacts() {
      persistCalls += 1;
      return [];
    },
  };

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await tool.invoke({ filePath: path.relative(basePath, textPath) }));
  assert.equal(payload.ok, true);
  assert.equal(payload.reusedExistingArtifact, true);
  assert.equal(payload.text, "already parsed\n".repeat(200));
  assert.equal(payload.transferEnvelopes[0].files[0].attachmentMeta.attachmentId, "existing-att");
  assert.equal(persistCalls, 0);
});

test("doc_to_data: reuses generated data artifact by path even without attachment meta", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-reuse-path-"));
  const textPath = path.join(
    basePath,
    "runtime",
    "attach",
    "scoped",
    "s1",
    "model",
    "input.media2data.image.md",
  );
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "already parsed without meta\n".repeat(100), "utf8");

  let persistCalls = 0;
  const agentContext = buildAgentContext(basePath);
  agentContext.execution.controllers.runtime.userId = "primary-user";
  agentContext.execution.controllers.runtime.systemRuntime = { sessionId: "s1" };
  agentContext.execution.controllers.runtime.attachmentService = {
    async ingestGeneratedArtifacts() {
      persistCalls += 1;
      return [];
    },
  };

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  const payload = JSON.parse(await tool.invoke({ filePath: path.relative(basePath, textPath) }));
  assert.equal(payload.ok, true);
  assert.equal(payload.reusedExistingArtifact, true);
  assert.equal(payload.text, "already parsed without meta\n".repeat(100));
  assert.equal(payload.transferEnvelopes[0].files[0].filePath.includes("input.media2data.image.md"), true);
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
      parseEngine: "libreoffice",
    }),
    (error) => {
      assert.equal(error?.code, ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE);
      assert.match(error?.message || "", /LibreOffice|vision|\.doc/);
      return true;
    },
  );
});

test("doc_to_data: libreoffice abort propagates instead of falling back to vision", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-abort-"));
  const docPath = path.join(basePath, "runtime", "ops_workdir", "input.docx");
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));

  const abortController = new AbortController();
  abortController.abort({ type: "user_stop" });
  const agentContext = buildAgentContext(basePath);
  agentContext.execution.controllers.runtime.abortSignal = abortController.signal;

  const tools = createDoc2DataTool({ agentContext });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({
      filePath: "runtime/ops_workdir/input.docx",
      parseEngine: "libreoffice",
    }),
    (error) => {
      assert.equal(error?.name, "AbortError");
      assert.equal(error?.code, "ABORT_ERR");
      return true;
    },
  );
});

test("doc_to_data: libreoffice fallback writes runtime-events session system event", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-telemetry-"));
  const docPath = path.join(basePath, "runtime", "ops_workdir", "input.docx");
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));

  const agentContext = buildAgentContext(basePath);
  const runtime = agentContext.execution.controllers.runtime;
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
    parseEngine: "libreoffice",
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
  assert.equal(records.length, 2);
  const parseFailedRecord = records.find(
    (record) => record.event === "agent.doc2data.libreofficeParse.failed",
  );
  const fallbackRecord = records.find(
    (record) => record.event === "agent.doc2data.libreofficeFallbackToVision",
  );
  assert.ok(parseFailedRecord);
  assert.ok(fallbackRecord);
  for (const record of [parseFailedRecord, fallbackRecord]) {
    assert.equal(record.source, "agent");
    assert.equal(record.channel, "direct");
    assert.equal(record.category, "system");
    assert.equal(record.userId, "u1");
    assert.equal(record.sessionId, "s1");
    assert.equal(record.dialogProcessId, "dp1");
    assert.equal(record.turnScopeId, "turn1");
    assert.equal(record.data.parseEngine, "libreoffice");
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
