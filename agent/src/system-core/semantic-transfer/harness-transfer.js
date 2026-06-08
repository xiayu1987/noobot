/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE } from "./constants.js";
import { persistTransferFile } from "./attachment-adapter.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "./result.js";
import { compactTransferPayloadForModel } from "./compact.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeDetailRefs(detailRefs = []) {
  return (Array.isArray(detailRefs) ? detailRefs : [])
    .map((item = {}, index) => {
      const source = isPlainObject(item) ? item : {};
      const name = normalizeString(source?.name || `detail-${index + 1}`);
      const path = normalizeString(
        source?.transferFilePath ||
          source?.filePath ||
          source?.relativePath ||
          source?.sandboxPath,
      );
      return path ? { name, path } : null;
    })
    .filter(Boolean);
}

export async function processStageMessage({
  runtime = {},
  agentContext = null,
  summary = "",
  detail = "",
  name = "harness-stage-detail.md",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "harness_stage_message",
  source = "plugin",
  reason = "harness_stage_message",
  meta = {},
} = {}) {
  const normalizedSummary = String(summary || "").trim();
  const normalizedDetail = String(detail || "").trim();

  if (!normalizedDetail) {
    return {
      summary: normalizedSummary,
      detail: "",
      transferResult: createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.SKIPPED }),
      transferEnvelope: null,
      transferEnvelopes: [],
      compactTransferPayload: {},
    };
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: normalizedDetail,
    name: normalizeString(name) || "harness-stage-detail.md",
    mimeType: normalizeString(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
    attachmentSource,
    generationSource,
    source,
    reason,
    meta,
  });

  const transferEnvelope =
    persisted?.envelope && typeof persisted.envelope === "object" && !Array.isArray(persisted.envelope)
      ? persisted.envelope
      : persisted?.result?.envelope && typeof persisted.result.envelope === "object" && !Array.isArray(persisted.result.envelope)
        ? persisted.result.envelope
        : null;
  const transferEnvelopes = transferEnvelope ? [transferEnvelope] : [];
  return {
    summary: normalizedSummary,
    detail: "",
    transferResult: transferEnvelope
      ? createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: transferEnvelope })
      : createTransferResult({ ok: false, status: TRANSFER_RESULT_STATUS.FAILED }),
    transferEnvelope,
    transferEnvelopes,
    compactTransferPayload: compactTransferPayloadForModel({ transferEnvelope, transferEnvelopes }),
  };
}

export function composeFinalMessage({
  resultInfo = "",
  detailRefs = [],
  validationInfo = "",
  header = "",
} = {}) {
  const resultText = String(resultInfo || "").trim();
  const validationText = String(validationInfo || "").trim();
  const detailLines = normalizeDetailRefs(detailRefs)
    .map((item = {}) => `- ${item.name}: ${item.path}`);

  return [
    normalizeString(header),
    resultText,
    detailLines.length ? "明细附件:" : "",
    ...detailLines,
    validationText ? "验收信息:" : "",
    validationText,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
