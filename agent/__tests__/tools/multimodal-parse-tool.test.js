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
  buildModelAttachment,
  createMultimodalParseTool,
} from "../../src/tools/ai-models/multimodal-parse-tool.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createEventEnvelope } from "@noobot/event-protocol";

const TRANSFER_IDENTITY = Object.freeze({
  transferId: "transfer:test:multimodal-parse:output",
  messageId: "message:test-multimodal-parse",
  sessionId: "session-1",
  turnScopeId: "turn:test-multimodal-parse",
  runId: "run:test-multimodal-parse",
  producer: { type: "tool", id: "call:test-multimodal-parse" },
});

test("multimodal_parse rasterizes SVG input for image-model protocols", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-svg-"));
  const inputPath = path.join(basePath, "visible.svg");
  await fs.writeFile(
    inputPath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><text x="10" y="45">VISIBLE</text></svg>',
    "utf8",
  );

  const attachment = await buildModelAttachment({
    filePath: inputPath,
    mimeType: "image/svg+xml",
    runtime: {},
  });
  assert.equal(attachment.mimeType, "image/png");
  assert.equal(attachment.fileName, "visible.png");
  assert.match(attachment.data, /^data:image\/png;base64,/);
  assert.deepEqual(
    Buffer.from(attachment.data.split(",", 2)[1], "base64").subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
});

test("multimodal_parse preserves attachment names and backwrites every user source", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-"));
  const relativePath = path.join("runtime", "attach", "scoped", "session-1", "user", "scan.png");
  const inputPath = path.join(basePath, relativePath);
  const secondRelativePath = path.join(
    "runtime",
    "attach",
    "scoped",
    "session-1",
    "user",
    "invoice.pdf",
  );
  const secondInputPath = path.join(basePath, secondRelativePath);
  const modelRelativePath = path.join(
    "runtime",
    "attach",
    "scoped",
    "session-1",
    "model",
    "38582bd8-547d-4189-9096-b1db03577511.docx",
  );
  const modelInputPath = path.join(basePath, modelRelativePath);
  await fs.mkdir(path.dirname(inputPath), { recursive: true });
  await fs.mkdir(path.dirname(modelInputPath), { recursive: true });
  await fs.writeFile(inputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(secondInputPath, Buffer.from([0x25, 0x50, 0x44, 0x46]));
  await fs.writeFile(modelInputPath, "model attachment", "utf8");

  let modelRequest = null;
  let ingestRequest = null;
  const linkRequests = [];
  const authorityRequests = [];
  const parentSessionId = ` ${"p".repeat(220)} `;
  const runtime = {
    basePath,
    userId: "admin",
    currentUserMessageUid: "user-source",
    currentUserMessageOrigin: "natural",
    runtimeModel: "parse-model",
    globalConfig: {
      multimodal: {
        parsing: {
          default_models: { image: "parse-model", document: "parse-model" },
        },
      },
      providers: {
        "parse-model": {
          enabled: true,
          used_for_conversation: true,
          api_key: "test-key",
          model: "gpt-5.4",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_parsing: { enabled: true, input_modalities: ["image", "document"] },
        },
      },
    },
    userConfig: {},
    systemRuntime: { sessionId: "session-1", rootSessionId: "session-1", parentSessionId },
    userMessageAttachments: [
      {
        attachmentId: "source-1",
        sessionId: "session-1",
        attachmentSource: "user",
        name: "scan.png",
        mimeType: "image/png",
        path: inputPath,
        relativePath,
      },
      {
        attachmentId: "source-2",
        sessionId: "session-1",
        attachmentSource: "user",
        name: "invoice.pdf",
        mimeType: "application/pdf",
        path: secondInputPath,
        relativePath: secondRelativePath,
      },
      {
        attachmentId: "source-3",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "workspace-file.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        path: modelInputPath,
        relativePath: modelRelativePath,
      },
    ],
    modelPort: {
      async invoke(request) {
        modelRequest = request;
        return { result: { rawText: "# Parsed\n\ninvoice data", output: [] } };
      },
    },
    attachmentService: {
      async getAttachmentById(request) {
        return runtime.userMessageAttachments.find(
          (attachment) =>
            attachment.attachmentId === request.attachmentId &&
            attachment.sessionId === request.sessionId &&
            attachment.attachmentSource === request.attachmentSource,
        );
      },
      async ingestGeneratedArtifacts(request) {
        ingestRequest = request;
        const artifact = request.artifacts[0];
        return [
          {
            attachmentId: "parsed-1",
            sessionId: "session-1",
            attachmentSource: "model",
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: Buffer.from(artifact.contentBase64, "base64").length,
            path: path.join(basePath, artifact.name),
            relativePath: artifact.name,
            generationSource: request.generationSource,
          },
        ];
      },
      async linkParsedResultToAttachment(request) {
        linkRequests.push(request);
        const source = runtime.userMessageAttachments.find(
          (attachment) => attachment.attachmentId === request.sourceIdentity.attachmentId,
        );
        return {
          ...source,
          relations: [
            {
              relationType: "parsed_result",
              sourceIdentity: request.sourceIdentity,
              targetIdentity: request.targetAttachment.identity,
              producer: { type: "tool", id: request.producerId },
              createdAt: "2026-08-16T00:00:00.000Z",
            },
          ],
        };
      },
    },
    sessionManager: {
      async commitAuthorityEvent(request) {
        authorityRequests.push(request);
        const { family, identity, causality, ordering, producer, payload } = request;
        return {
          committed: true,
          envelope: createEventEnvelope({
            family,
            identity: {
              ...identity,
              eventId: `attachment-authority:${identity.messageId}`,
              sessionId: "session-1",
            },
            causality,
            ordering: { ...ordering, sequence: 1 },
            producer,
            occurredAt: payload.occurredAt,
            payload,
          }),
        };
      },
    },
  };
  const agentContext = createTestAgentExecutionScope(runtime);
  const [tool] = createMultimodalParseTool({ agentContext });
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [
          { source: "attachment:v1:session-1/user/source-1" },
          { source: "attachment:v1:session-1/user/source-2" },
          { source: "attachment:v1:session-1/model/source-3" },
        ],
        prompt: "Extract the invoice",
      },
      { configurable: { transferIdentity: TRANSFER_IDENTITY } },
    ),
  );

  assert.equal(modelRequest.operation.kind, "multimodal_parse");
  assert.equal(modelRequest.operation.input.prompt, "Extract the invoice");
  assert.equal(modelRequest.operation.input.attachments.length, 3);
  assert.equal(modelRequest.operation.input.attachments[0].mimeType, "image/png");
  assert.equal(modelRequest.operation.input.attachments[0].fileName, "scan.png");
  assert.match(modelRequest.operation.input.attachments[0].data, /^data:image\/png;base64,/);
  assert.equal(modelRequest.operation.input.attachments[1].mimeType, "application/pdf");
  assert.equal(modelRequest.operation.input.attachments[1].fileName, "invoice.pdf");
  assert.equal(modelRequest.operation.input.attachments[2].fileName, "workspace-file.docx");
  assert.equal(modelRequest.invocation.contextSequencePolicy, "independent_request");
  assert.equal(ingestRequest.generationSource, "multimodal_parse_tool");
  assert.equal(ingestRequest.artifacts[0].name, "scan.multimodal-parse.multimodal_model.md");
  assert.deepEqual(
    linkRequests.map((request) => request.sourceIdentity.attachmentId),
    ["source-1", "source-2"],
  );
  assert.ok(linkRequests.every((request) => request.producerId === "multimodal_parse"));
  assert.ok(authorityRequests.every((request) => request.parentSessionId === "p".repeat(200)));
  assert.equal(
    runtime.userMessageAttachments[0].relations[0].targetIdentity.attachmentId,
    "parsed-1",
  );
  assert.equal(
    runtime.userMessageAttachments[1].relations[0].targetIdentity.attachmentId,
    "parsed-1",
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.source_attachment_backwritten_count, 2);
  assert.equal(result.summary.input_file_count, 3);
  assert.deepEqual(result.summary.input_modalities, ["image", "document"]);
  assert.deepEqual(result.summary.source_attachment_refs, [
    "attachment:v1:session-1/user/source-1",
    "attachment:v1:session-1/user/source-2",
    "attachment:v1:session-1/model/source-3",
  ]);
  assert.equal(result.summary.saved_attachment_count, 1);
});

test("multimodal_parse parses a workspace file without source-attachment backwrite", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-source-"));
  const inputPath = path.join(basePath, "ordinary.pdf");
  await fs.writeFile(inputPath, "not an attachment", "utf8");
  let modelCalled = false;
  let linkCalled = false;
  const agentContext = createTestAgentExecutionScope({
    basePath,
    userId: "admin",
    runtimeModel: "parse-model",
    globalConfig: {
      multimodal: { parsing: { default_models: { document: "parse-model" } } },
      providers: {
        "parse-model": {
          enabled: true,
          used_for_conversation: true,
          api_key: "test-key",
          model: "gpt-5.4",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_parsing: { enabled: true, input_modalities: ["document"] },
        },
      },
    },
    userConfig: {},
    systemRuntime: { sessionId: "session-1", rootSessionId: "session-1" },
    userMessageAttachments: [],
    modelPort: {
      async invoke() {
        modelCalled = true;
        return { result: { rawText: "parsed ordinary file", output: [] } };
      },
    },
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return [
          {
            attachmentId: "parsed-ordinary",
            sessionId: "session-1",
            attachmentSource: "model",
            name: request.artifacts[0].name,
            mimeType: request.artifacts[0].mimeType,
            size: 20,
            path: path.join(basePath, request.artifacts[0].name),
            relativePath: request.artifacts[0].name,
          },
        ];
      },
      async linkParsedResultToAttachment() {
        linkCalled = true;
      },
    },
  });
  const [tool] = createMultimodalParseTool({ agentContext });
  const result = JSON.parse(
    await tool.invoke(
      { inputs: [{ source: "ordinary.pdf" }] },
      { configurable: { transferIdentity: TRANSFER_IDENTITY } },
    ),
  );

  assert.equal(modelCalled, true);
  assert.equal(linkCalled, false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary.source_attachment_refs, []);
  assert.equal(result.summary.source_attachment_backwritten_count, 0);
});

test("multimodal_parse rejects directly readable text before invoking a model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-text-"));
  await fs.writeFile(path.join(basePath, "tool-result.txt"), '{"attachments":[]}', "utf8");
  let modelCalled = false;
  const agentContext = createTestAgentExecutionScope({
    basePath,
    userId: "admin",
    userMessageAttachments: [],
    modelPort: {
      async invoke() {
        modelCalled = true;
      },
    },
  });
  const [tool] = createMultimodalParseTool({ agentContext });

  await assert.rejects(
    () => tool.invoke({ inputs: [{ source: "tool-result.txt" }] }),
    /read_file|资源分段读取/,
  );
  assert.equal(modelCalled, false);
});

test("multimodal_parse passes audio and video files to the configured model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-media-"));
  await fs.writeFile(path.join(basePath, "recording.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  await fs.writeFile(path.join(basePath, "clip.mp4"), Buffer.from([0x00, 0x00, 0x00, 0x18]));
  let modelRequest = null;
  const agentContext = createTestAgentExecutionScope({
    basePath,
    userId: "admin",
    runtimeModel: "parse-model",
    globalConfig: {
      multimodal: {
        parsing: { default_models: { audio: "parse-model", video: "parse-model" } },
      },
      providers: {
        "parse-model": {
          enabled: true,
          model: "qwen3.5-omni-plus",
          reasoning_effort_parameter: "enable_thinking",
          reasoning_effort_options: ["none", "medium"],
          multimodal_parsing: { enabled: true, input_modalities: ["audio", "video"] },
        },
      },
    },
    userConfig: {},
    systemRuntime: { sessionId: "session-1", rootSessionId: "session-1" },
    userMessageAttachments: [],
    modelPort: {
      async invoke(request) {
        modelRequest = request;
        return { result: { rawText: "parsed media", output: [] } };
      },
    },
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return [
          {
            attachmentId: "parsed-media",
            sessionId: "session-1",
            attachmentSource: "model",
            name: request.artifacts[0].name,
            mimeType: request.artifacts[0].mimeType,
            size: 12,
            path: path.join(basePath, request.artifacts[0].name),
            relativePath: request.artifacts[0].name,
          },
        ];
      },
    },
  });
  const [tool] = createMultimodalParseTool({ agentContext });

  const result = JSON.parse(
    await tool.invoke(
      { inputs: [{ source: "recording.wav" }, { source: "clip.mp4" }] },
      { configurable: { transferIdentity: TRANSFER_IDENTITY } },
    ),
  );

  assert.deepEqual(
    modelRequest.operation.input.attachments.map(({ mimeType, fileName }) => ({
      mimeType,
      fileName,
    })),
    [
      { mimeType: "audio/wav", fileName: "recording.wav" },
      { mimeType: "video/mp4", fileName: "clip.mp4" },
    ],
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.input_file_count, 2);
});

test("multimodal_parse rejects combined files at the official 50 MB request limit", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-limit-"));
  const firstPath = path.join(basePath, "first.pdf");
  const secondPath = path.join(basePath, "second.pdf");
  const firstHandle = await fs.open(firstPath, "w");
  const secondHandle = await fs.open(secondPath, "w");
  await firstHandle.truncate(25 * 1000 * 1000);
  await secondHandle.truncate(25 * 1000 * 1000);
  await firstHandle.close();
  await secondHandle.close();
  let modelCalled = false;
  const agentContext = createTestAgentExecutionScope({
    basePath,
    userId: "admin",
    userMessageAttachments: [],
    modelPort: {
      async invoke() {
        modelCalled = true;
      },
    },
  });
  const [tool] = createMultimodalParseTool({ agentContext });

  await assert.rejects(
    () => tool.invoke({ inputs: [{ source: "first.pdf" }, { source: "second.pdf" }] }),
    /50 MB/,
  );
  assert.equal(modelCalled, false);
});

test("multimodal_parse rejects an explicitly selected model without parsing capability", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-model-"));
  await fs.writeFile(path.join(basePath, "input.pdf"), "content", "utf8");
  const agentContext = createTestAgentExecutionScope({
    basePath,
    userId: "admin",
    runtimeModel: "parse-model",
    globalConfig: {
      multimodal: { parsing: { default_models: { document: "parse-model" } } },
      providers: {
        "parse-model": {
          enabled: true,
          model: "gpt-5.4",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_parsing: { enabled: true, input_modalities: ["document"] },
        },
        "text-only": {
          enabled: true,
          model: "text-only",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_parsing: { enabled: false },
        },
      },
    },
    userConfig: {},
    userMessageAttachments: [],
  });
  const [tool] = createMultimodalParseTool({ agentContext });

  await assert.rejects(
    () => tool.invoke({ inputs: [{ source: "input.pdf" }], model_name: "text-only" }),
    (error) =>
      error?.code === "RECOVERABLE_MODEL_NOT_FOUND" &&
      /多模态解析|multimodal parsing/.test(error.message),
  );
});

test("multimodal_parse uses the configured modality default instead of the runtime model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-multimodal-parse-fallback-"));
  await fs.writeFile(path.join(basePath, "input.pdf"), "content", "utf8");
  let invokedModel = null;
  const agentContext = createTestAgentExecutionScope({
    basePath,
    userId: "admin",
    runtimeModel: "conversation-model",
    globalConfig: {
      multimodal: { parsing: { default_models: { document: "parse-model" } } },
      providers: {
        "conversation-model": {
          enabled: true,
          model: "text-only",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_parsing: { enabled: false },
        },
        "parse-model": {
          enabled: true,
          model: "gpt-5.4",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          multimodal_parsing: { enabled: true, input_modalities: ["document"] },
        },
      },
    },
    userConfig: {},
    userMessageAttachments: [],
    modelPort: {
      async invoke(request) {
        invokedModel = request.model;
        return { result: { rawText: "parsed", output: [] } };
      },
    },
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return [
          {
            attachmentId: "parsed-fallback",
            sessionId: "session-1",
            attachmentSource: "model",
            name: request.artifacts[0].name,
            mimeType: request.artifacts[0].mimeType,
            size: 6,
            path: path.join(basePath, request.artifacts[0].name),
            relativePath: request.artifacts[0].name,
          },
        ];
      },
    },
  });
  const [tool] = createMultimodalParseTool({ agentContext });

  const result = JSON.parse(
    await tool.invoke(
      { inputs: [{ source: "input.pdf" }] },
      { configurable: { transferIdentity: TRANSFER_IDENTITY } },
    ),
  );
  assert.equal(invokedModel.alias, "parse-model");
  assert.equal(result.model.alias, "parse-model");
});
