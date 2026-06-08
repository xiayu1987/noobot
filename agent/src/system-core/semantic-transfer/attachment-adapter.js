/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { mapAttachmentRecordsToMetas } from "../attach/index.js";
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_DIRECTION, TRANSFER_STORAGE_KIND, TRANSFER_TRANSPORT } from "./constants.js";
import { createTransferEnvelope } from "./envelope.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "./result.js";
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
      agentContext?.environment?.userId,
  );
}

function resolveSessionId({ runtime = {}, agentContext = null, sessionId = "" } = {}) {
  return normalizeString(
    sessionId ||
      runtime?.systemRuntime?.sessionId ||
      runtime?.sessionId ||
      agentContext?.sessionId ||
      agentContext?.session?.id ||
      agentContext?.session?.current?.sessionId,
  );
}

function emptyPersistResult(status = TRANSFER_RESULT_STATUS.SKIPPED, error = null) {
  const result = createTransferResult({ ok: status !== TRANSFER_RESULT_STATUS.FAILED, status, error });
  return {
    result,
    transferResult: result,
    transferEnvelope: null,
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
  const service = attachmentService || runtime?.attachmentService || null;
  if (!service || typeof service.ingestGeneratedArtifacts !== "function") {
    return emptyPersistResult();
  }
  const resolvedUserId = resolveUserId({ runtime, agentContext, userId });
  const resolvedSessionId = resolveSessionId({ runtime, agentContext, sessionId });
  const artifactList = Array.isArray(artifacts) ? artifacts : [];
  if (!resolvedUserId || !resolvedSessionId || !artifactList.length) {
    return emptyPersistResult();
  }

  const resolvedGenerationSource =
    normalizeString(generationSource || reason || source) || "semantic_transfer_output";
  const records = await service.ingestGeneratedArtifacts({
    userId: resolvedUserId,
    sessionId: resolvedSessionId,
    attachmentSource: normalizeString(attachmentSource) || "model",
    generationSource: resolvedGenerationSource,
    artifacts: artifactList,
  });
  const attachmentMetas = mapAttachmentRecordsToMetas(records, {
    fallbackMimeType: normalizeString(fallbackMimeType) || DEFAULT_TRANSFER_MIME_TYPE,
    fallbackGenerationSource: resolvedGenerationSource,
  });
  const purpose = reason || resolvedGenerationSource || "semantic_transfer_file_path";
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
        attachmentSource: normalizeString(attachmentSource) || "model",
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
      source,
      reason: purpose,
      mimeType: normalizeString(fallbackMimeType) || DEFAULT_TRANSFER_MIME_TYPE,
      fileCount: files.length,
    },
  });
  const result = createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope });
  return {
    result,
    transferResult: result,
    envelope,
    transferEnvelope: envelope,
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
    fallbackMimeType: normalizeString(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
    source,
    reason,
    storage,
    producer,
    meta,
    artifacts: [
      {
        name: normalizeString(name) || "output.txt",
        mimeType: normalizeString(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
        contentBase64: resolvedContentBase64,
      },
    ],
  });
}
