/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { buildTextResultFields, buildTransferFileEntry, createTransferEnvelope, getTransferAttachmentMetas, materializeTextForToolResult, resolveToolResultInlineTextLimit, TRANSFER_REASON, TRANSFER_SOURCE } from "../../../semantic-transfer/index.js";
import { MIME_TYPE } from "../../../constants/index.js";
import { ARTIFACT_GENERATION_SOURCE, TOOL_ATTACHMENT_SOURCE, TOOL_NAME } from "../../constants/index.js";
import { updateRuntimeUserMessageAttachment } from "../../../attach/index.js";
import { emitEvent } from "../../../event/index.js";

const DATA_PROCESSING_ARTIFACT_SOURCES = new Set([
  ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
  ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL,
]);
export function isGeneratedDataProcessingArtifact(attachmentMeta = null) {
  if (!attachmentMeta || typeof attachmentMeta !== "object" || Array.isArray(attachmentMeta)) return false;
  return DATA_PROCESSING_ARTIFACT_SOURCES.has(String(attachmentMeta?.generationSource || "").trim());
}

export function looksLikeDataProcessingArtifactPath(filePath = "") {
  const baseName = path.basename(String(filePath || "").trim()).toLowerCase();
  return (
    baseName.includes(".doc2data.") ||
    baseName.includes(".media2data.")
  ) && baseName.endsWith(".md");
}

export function buildFallbackArtifactMeta({
  runtime = {},
  basePath = "",
  inputFile = "",
  bytes = 0,
} = {}) {
  const normalizedInput = String(inputFile || "").trim();
  const normalizedBase = String(basePath || runtime?.basePath || "").trim();
  const relativePath = normalizedBase && normalizedInput.startsWith(normalizedBase)
    ? path.relative(normalizedBase, normalizedInput)
    : "";
  const baseName = path.basename(normalizedInput);
  const generationSource = baseName.toLowerCase().includes(".media2data.")
    ? ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL
    : ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL;
  return {
    name: baseName,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    size: Number(bytes || 0),
    path: normalizedInput,
    ...(relativePath ? { relativePath } : {}),
    generatedByModel: true,
    generationSource,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
  };
}

export function buildExistingArtifactPersistedOutput({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  text = "",
} = {}) {
  if (!attachmentMeta || typeof attachmentMeta !== "object" || Array.isArray(attachmentMeta)) {
    return { attachments: [], transferEnvelopes: [] };
  }
  const file = buildTransferFileEntry({
    runtime,
    agentContext,
    attachmentMeta,
    purpose: "reuse_data_processing_artifact",
    role: "primary",
  });
  const envelope = createTransferEnvelope({
    direction: "output",
    transport: "file",
    files: [file],
    storage: {
      kind: "attachment",
      attachmentSource: String(attachmentMeta?.attachmentSource || TOOL_ATTACHMENT_SOURCE.MODEL),
      generationSource: String(attachmentMeta?.generationSource || ""),
      reused: true,
    },
    producer: { type: "tool", name: TOOL_NAME.DOC_TO_DATA },
    meta: {
      source: TRANSFER_SOURCE.TOOL,
      reason: TRANSFER_REASON.REUSE_DATA_PROCESSING_ARTIFACT,
      mimeType: String(attachmentMeta?.mimeType || MIME_TYPE.TEXT_MARKDOWN),
    },
  });
  const transferEnvelopes = [envelope];
  return {
    attachments: [attachmentMeta],
    transferEnvelopes,
    resultFields: buildTextResultFields({
      text,
      transferEnvelopes,
      inlineMaxChars: resolveToolResultInlineTextLimit(runtime),
    }),
  };
}
function sanitizeArtifactBaseName(input = "", fallback = "doc2data_result") {
  const normalized = String(input || "").trim();
  if (!normalized) return fallback;
  return normalized.replace(/[^\w.-]+/g, "_");
}

function resolveLibreOfficeOutputFormat(inputFileName = "") {
  const extension = path.extname(String(inputFileName || "").trim()).toLowerCase();
  // Calc/Spreadsheet documents usually cannot export directly to plain txt.
  // Use csv as a stable text representation.
  if ([
    ".xlsx",
    ".xls",
    ".xlsm",
    ".xlsb",
    ".ods",
    ".csv",
  ].includes(extension)) {
    return {
      format: "csv",
      filter: undefined,
      mode: "libreoffice_csv",
    };
  }
  return {
    format: "txt",
    filter: undefined,
    mode: "libreoffice_text",
  };
}

export async function persistDoc2DataTextAttachment({
  runtime = {},
  agentContext = null,
  inputFile = "",
  text = "",
  mode = "",
}) {
  const inputBaseName = sanitizeArtifactBaseName(
    path.basename(String(inputFile || "").trim(), path.extname(String(inputFile || "").trim())),
  );
  const modeSuffix = sanitizeArtifactBaseName(mode || "result", "result");
  const artifactName = `${inputBaseName}.doc2data.${modeSuffix}.md`;
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text,
    name: artifactName,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
    generationSource: ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
    source: TRANSFER_SOURCE.TOOL,
    reason: ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
    alwaysPersist: true,
    producer: { type: "tool", name: TOOL_NAME.DOC_TO_DATA },
    meta: { mode, inputFile },
  });
  const attachments = getTransferAttachmentMetas(materialized.transferEnvelopes);
  return {
    attachments,
    transferEnvelopes: materialized.transferEnvelopes,
    resultFields: materialized.resultFields,
  };
}

async function backwriteParsedResultToSourceAttachment({
  runtime = {},
  sourceAttachmentMeta = null,
  parsedAttachmentMeta = null,
}) {
  const sourceAttachmentId = String(sourceAttachmentMeta?.attachmentId || "").trim();
  if (!sourceAttachmentId || !parsedAttachmentMeta) return null;
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || "").trim();
  if (!attachmentService || !userId) return null;
  try {
    const updatedSourceAttachment = await attachmentService.linkParsedResultToAttachment({
      userId,
      sourceAttachmentId,
      parsedAttachmentMeta,
      toolName: TOOL_NAME.DOC_TO_DATA,
      sourceSessionId: String(sourceAttachmentMeta?.sessionId || "").trim(),
      sourceAttachmentSource: String(sourceAttachmentMeta?.attachmentSource || "").trim(),
      sourceAttachmentPath: String(sourceAttachmentMeta?.path || "").trim(),
    });
    updateRuntimeUserMessageAttachment(runtime, sourceAttachmentId, updatedSourceAttachment || {});
    if (updatedSourceAttachment) {
      emitEvent(runtime?.eventListener || null, "attachment_parsed", {
        dialogProcessId: String(runtime?.systemRuntime?.dialogProcessId || "").trim(),
        attachments: [updatedSourceAttachment],
      });
    }
    return updatedSourceAttachment;
  } catch {
    return null;
  }
}

export function normalizePersistedAttachments(persistedOutput) {
  return Array.isArray(persistedOutput?.attachments)
    ? persistedOutput.attachments
    : [];
}

export async function backwriteFirstAttachment({ runtime, sourceAttachmentMeta, attachments }) {
  return backwriteParsedResultToSourceAttachment({
    runtime,
    sourceAttachmentMeta,
    parsedAttachmentMeta: attachments[0] || null,
  });
}
