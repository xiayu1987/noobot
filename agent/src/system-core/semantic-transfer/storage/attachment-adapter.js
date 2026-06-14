/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { AttachmentService } from "../../attach/service/attachment-service.js";
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_DIRECTION,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  TRANSFER_STORAGE_KIND,
  TRANSFER_TRANSPORT,
} from "../core/constants.js";
import { createTransferEnvelope } from "../envelope/envelope.js";
import { resolveTransferIntent } from "../core/intent.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "../core/result.js";
import { firstNormalizedString } from "../core/compact.js";
import { buildTransferFileEntry } from "./path-resolver.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function resolveUserId({ runtime = {}, agentContext = null, userId = "" } = {}) {
  return normalizeString(
    userId ||
      runtime?.systemRuntime?.userId ||
      runtime?.userId ||
      agentContext?.userId ||
      agentContext?.environment?.identity?.userId ||
      agentContext?.environment?.userId,
  );
}

function resolveSessionId({ runtime = {}, agentContext = null, sessionId = "" } = {}) {
  return normalizeString(
    sessionId ||
      runtime?.systemRuntime?.sessionId ||
      runtime?.sessionId ||
      agentContext?.sessionId ||
      agentContext?.session?.current?.id ||
      agentContext?.session?.id ||
      agentContext?.session?.current?.sessionId,
  );
}

function resolveFallbackSessionId({ runtime = {}, agentContext = null, sessionId = "" } = {}) {
  return resolveSessionId({ runtime, agentContext, sessionId }) || "default";
}

function emptyPersistResult(status = TRANSFER_RESULT_STATUS.SKIPPED, error = null) {
  const result = createTransferResult({ ok: status !== TRANSFER_RESULT_STATUS.FAILED, status, error });
  return {
    result,
    transferResult: result,
    transferEnvelopes: [],
    records: [],
  };
}

function resolveContentBase64({
  content = "",
  contentBase64 = "",
  bytes = null,
  contentEncoding = "utf8",
} = {}) {
  const explicitBase64 = normalizeString(contentBase64);
  if (explicitBase64) return explicitBase64;
  if (Buffer.isBuffer(bytes)) return bytes.toString("base64");
  if (bytes instanceof Uint8Array) return Buffer.from(bytes).toString("base64");
  if (Array.isArray(bytes)) return Buffer.from(bytes).toString("base64");
  const normalizedEncoding = normalizeString(contentEncoding).toLowerCase();
  if (normalizedEncoding === "base64") return normalizeString(content);
  const text = String(content || "");
  return text ? Buffer.from(text, "utf8").toString("base64") : "";
}

function createFallbackAttachmentService(runtime = {}) {
  const workspaceRoot = normalizeString(runtime?.globalConfig?.workspaceRoot);
  if (!workspaceRoot) return null;
  return new AttachmentService(runtime.globalConfig);
}

function resolveWorkspaceBasePath({ runtime = {}, agentContext = null } = {}) {
  return normalizeString(runtime?.basePath || agentContext?.environment?.workspace?.basePath);
}

function shouldUseLocalToolOverflowFallback({ service = null, generationSource = "", reason = "" } = {}) {
  if (service && typeof service.ingestGeneratedArtifacts === "function") return false;
  return [generationSource, reason].some((value) => normalizeString(value) === TRANSFER_REASON.TOOL_RESULT_OVERFLOW);
}

function buildLocalToolOverflowRecord({
  artifact = {},
  contentBytes = null,
  filePath = "",
  relativePath = "",
  sessionId = "",
  generationSource = TRANSFER_REASON.TOOL_RESULT_OVERFLOW,
} = {}) {
  const name = firstNormalizedString(artifact?.name, path.basename(filePath), "tool-result-overflow.txt");
  return {
    attachmentId: `tool-result-overflow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sessionId,
    attachmentSource: "model",
    name,
    mimeType: normalizeString(artifact?.mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
    size: contentBytes?.length || 0,
    path: filePath,
    relativePath,
    generatedByModel: true,
    generationSource,
  };
}

async function persistLocalToolOverflowArtifacts({
  runtime = {},
  agentContext = null,
  sessionId = "",
  artifacts = [],
  generationSource = TRANSFER_REASON.TOOL_RESULT_OVERFLOW,
} = {}) {
  const basePath = resolveWorkspaceBasePath({ runtime, agentContext });
  const artifactList = Array.isArray(artifacts) ? artifacts : [];
  if (!basePath || !sessionId || !artifactList.length) return [];

  const outputDir = path.join(basePath, "runtime", "ops_workdir", ".tool-result-overflow", sessionId);
  await fs.mkdir(outputDir, { recursive: true });
  const records = [];
  for (const [index, artifact] of artifactList.entries()) {
    const fallbackName = `tool-result-overflow-${index + 1}.txt`;
    const name = firstNormalizedString(artifact?.name, fallbackName);
    const safeName = firstNormalizedString(path.basename(name), fallbackName);
    const filePath = path.join(outputDir, `${Date.now()}-${index}-${safeName}`);
    const contentBase64 = resolveContentBase64({
      content: artifact?.content,
      contentBase64: artifact?.contentBase64,
      bytes: artifact?.bytes,
      contentEncoding: artifact?.contentEncoding,
    });
    const contentBytes = Buffer.from(contentBase64, "base64");
    await fs.writeFile(filePath, contentBytes);
    records.push(buildLocalToolOverflowRecord({
      artifact,
      contentBytes,
      filePath,
      relativePath: path.relative(basePath, filePath),
      sessionId,
      generationSource,
    }));
  }
  return records;
}

export async function persistTransferArtifacts({
  runtime = {},
  agentContext = null,
  attachmentService = null,
  userId = "",
  sessionId = "",
  artifacts = [],
  attachmentSource = "model",
  generationSource = "semantic_transfer_output",
  fallbackMimeType = DEFAULT_TRANSFER_MIME_TYPE,
  source = "",
  reason = "",
  storage = null,
  producer = null,
  meta = {},
} = {}) {
  const service = attachmentService || runtime?.attachmentService || createFallbackAttachmentService(runtime);
  const resolvedUserId = resolveUserId({ runtime, agentContext, userId });
  const resolvedSessionId = shouldUseLocalToolOverflowFallback({ service, generationSource, reason })
    ? resolveFallbackSessionId({ runtime, agentContext, sessionId })
    : resolveSessionId({ runtime, agentContext, sessionId });
  const artifactList = Array.isArray(artifacts) ? artifacts : [];
  if (!resolvedSessionId || !artifactList.length) {
    return emptyPersistResult();
  }

  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.SERVICE,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
    defaultGenerationSource: TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
    allowCustom: true,
  });
  const resolvedGenerationSource = intent.generationSource;
  let records = [];
  if (service && typeof service.ingestGeneratedArtifacts === "function" && resolvedUserId) {
    records = await service.ingestGeneratedArtifacts({
      userId: resolvedUserId,
      sessionId: resolvedSessionId,
      attachmentSource: firstNormalizedString(attachmentSource, "model"),
      generationSource: resolvedGenerationSource,
      artifacts: artifactList,
    });
  } else if (shouldUseLocalToolOverflowFallback({ service, generationSource: resolvedGenerationSource, reason })) {
    records = await persistLocalToolOverflowArtifacts({
      runtime,
      agentContext,
      sessionId: resolvedSessionId,
      artifacts: artifactList,
      generationSource: resolvedGenerationSource,
    });
  }
  if (!records.length) return emptyPersistResult();
  const attachmentMetas = mapAttachmentRecordsToMetas(records, {
    fallbackMimeType: firstNormalizedString(fallbackMimeType, DEFAULT_TRANSFER_MIME_TYPE),
    fallbackGenerationSource: resolvedGenerationSource,
  });
  const purpose = intent.reason || resolvedGenerationSource || TRANSFER_REASON.SEMANTIC_TRANSFER_FILE_PATH;
  const files = attachmentMetas.map((attachmentMeta, index) =>
    buildTransferFileEntry({
      runtime,
      agentContext,
      attachmentMeta,
      purpose,
      role: index === 0 ? "primary" : "secondary",
    }),
  );
  const filePaths = files.map((item = {}) => normalizeString(item?.filePath)).filter(Boolean);
  const attachmentMeta = attachmentMetas[0] || null;
  const resolvedStorage = storage && typeof storage === "object" && !Array.isArray(storage)
    ? storage
    : {
        kind: TRANSFER_STORAGE_KIND.ATTACHMENT,
        attachmentSource: firstNormalizedString(attachmentSource, "model"),
        generationSource: resolvedGenerationSource,
      };
  const envelope = createTransferEnvelope({
    direction: TRANSFER_DIRECTION.OUTPUT,
    transport: TRANSFER_TRANSPORT.FILE,
    filePath: filePaths[0] || "",
    attachmentMeta,
    files,
    pathView: files[0]?.pathView || null,
    storage: resolvedStorage,
    producer,
    meta: {
      ...meta,
      source: intent.source,
      reason: purpose,
      mimeType: firstNormalizedString(fallbackMimeType, DEFAULT_TRANSFER_MIME_TYPE),
      fileCount: files.length,
    },
  });
  const result = createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope });
  return {
    result,
    transferResult: result,
    envelope,
    transferEnvelopes: [envelope],
    records,
  };
}

export async function persistTransferFile({
  runtime = {},
  agentContext = null,
  attachmentService = null,
  userId = "",
  sessionId = "",
  content = "",
  contentBase64 = "",
  bytes = null,
  contentEncoding = "utf8",
  name = "output.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_output",
  source = "",
  reason = "",
  storage = null,
  producer = null,
  meta = {},
} = {}) {
  const resolvedContentBase64 = resolveContentBase64({ content, contentBase64, bytes, contentEncoding });
  if (!resolvedContentBase64) return emptyPersistResult();
  return persistTransferArtifacts({
    runtime,
    agentContext,
    attachmentService,
    userId,
    sessionId,
    attachmentSource,
    generationSource,
    fallbackMimeType: firstNormalizedString(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
    source,
    reason,
    storage,
    producer,
    meta,
    artifacts: [
      {
        name: firstNormalizedString(name, "output.txt"),
        mimeType: firstNormalizedString(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
        contentBase64: resolvedContentBase64,
      },
    ],
  });
}
