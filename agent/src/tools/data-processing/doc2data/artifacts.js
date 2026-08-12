/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { buildTextResultFields, createExistingAttachmentTransferEnvelope, getTransferAttachments, materializeTextForToolResult, resolveToolResultInlineTextLimit, TRANSFER_REASON, TRANSFER_SOURCE } from "../../../transfer-adapter/index.js";
import { MIME_TYPE } from "../../../shared/constants/index.js";
import { ARTIFACT_GENERATION_SOURCE, TOOL_ATTACHMENT_SOURCE, TOOL_NAME } from "../../constants/index.js";
import { updateRuntimeUserMessageAttachment } from "../../../artifacts/index.js";
import { emitEvent } from "../../../events/index.js";

const DATA_PROCESSING_ARTIFACT_SOURCES = new Set([
  ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
  ARTIFACT_GENERATION_SOURCE.MEDIA_TO_DATA_TOOL,
  ARTIFACT_GENERATION_SOURCE.MULTIMODAL_PARSE_TOOL,
  ARTIFACT_GENERATION_SOURCE.WEB_TO_DATA_TOOL,
]);

export function isGeneratedDataProcessingArtifact(attachmentMeta = null) {
  if (!attachmentMeta || typeof attachmentMeta !== "object" || Array.isArray(attachmentMeta)) return false;
  return DATA_PROCESSING_ARTIFACT_SOURCES.has(String(attachmentMeta?.generationSource || "").trim());
}

export function buildExistingArtifactPersistedOutput({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  text = "",
  identity = null,
} = {}) {
  if (!attachmentMeta || typeof attachmentMeta !== "object" || Array.isArray(attachmentMeta)) {
    return { attachments: [], transferEnvelopes: [] };
  }
  const runConfig = runtime?.runConfig || {};
  const producerId = String(identity?.producer?.id || attachmentMeta?.attachmentId || "").trim();
  const messageId = String(identity?.messageId || runConfig.messageId || "").trim();
  const turnScopeId = String(identity?.turnScopeId || runConfig.turnScopeId || "").trim();
  const runId = String(identity?.runId || runConfig.executionId || "").trim();
  const sessionId = String(identity?.sessionId || attachmentMeta?.sessionId || runConfig.sessionId || runtime?.sessionId || "").trim();
  if (!producerId || !messageId || !turnScopeId || !runId || !sessionId) {
    throw new Error("semantic_transfer_reused_artifact_identity_incomplete");
  }
  const envelope = createExistingAttachmentTransferEnvelope({
    identity: {
      transferId: `transfer:${messageId}:${producerId}:output:reuse_data_processing_artifact`,
      messageId,
      sessionId,
      turnScopeId,
      runId,
      producer: identity?.producer || { type: "tool", id: producerId },
    },
    attachmentMeta,
    source: TRANSFER_SOURCE.TOOL,
    reason: TRANSFER_REASON.REUSE_DATA_PROCESSING_ARTIFACT,
    scenario: "tool",
    strategy: "tool_output",
  });
  const transferEnvelopes = [envelope];
  return {
    attachments: getTransferAttachments(transferEnvelopes),
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
  identity = null,
  toolName = TOOL_NAME.DOC_TO_DATA,
  generationSource = ARTIFACT_GENERATION_SOURCE.DOC_TO_DATA_TOOL,
  artifactLabel = "doc2data",
}) {
  const inputBaseName = sanitizeArtifactBaseName(
    path.basename(String(inputFile || "").trim(), path.extname(String(inputFile || "").trim())),
  );
  const modeSuffix = sanitizeArtifactBaseName(mode || "result", "result");
  const artifactName = `${inputBaseName}.${sanitizeArtifactBaseName(artifactLabel, "doc2data")}.${modeSuffix}.md`;
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text,
    name: artifactName,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
    generationSource,
    source: TRANSFER_SOURCE.TOOL,
    reason: generationSource,
    alwaysPersist: true,
    producer: { type: "tool", name: toolName },
    identity,
    meta: { mode, inputFile },
  });
  const attachments = getTransferAttachments(materialized.transferEnvelopes);
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
  toolName = TOOL_NAME.DOC_TO_DATA,
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
      toolName,
      sourceSessionId: String(sourceAttachmentMeta?.sessionId || "").trim(),
      sourceAttachmentSource: String(sourceAttachmentMeta?.attachmentSource || "").trim(),
    });
    updateRuntimeUserMessageAttachment(runtime, sourceAttachmentId, updatedSourceAttachment || {});
    if (updatedSourceAttachment) {
      emitEvent(runtime?.eventListener || null, "attachment_parsed", {
        dialogProcessId: String(runtime?.systemRuntime?.dialogProcessId || "").trim(),
        turnScopeId: String(runtime?.systemRuntime?.turnScopeId || "").trim(),
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

export async function backwriteFirstAttachment({ runtime, sourceAttachmentMeta, attachments, toolName }) {
  const firstAttachment = attachments?.[0] || null;
  const parsedAttachmentMeta = firstAttachment?.identity
    ? {
        ...firstAttachment.identity,
        name: firstAttachment.name,
        mimeType: firstAttachment.mimeType,
        size: firstAttachment.size,
      }
    : firstAttachment;
  return backwriteParsedResultToSourceAttachment({
    runtime,
    sourceAttachmentMeta,
    parsedAttachmentMeta,
    toolName,
  });
}
