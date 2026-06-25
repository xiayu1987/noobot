/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_REASON, TRANSFER_SOURCE } from "../core/constants.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import {
  normalizeTransferEnvelopesWithPolicy,
} from "../envelope/envelope-utils.js";
import { resolveTransferIntent } from "../core/intent.js";
import { emitSemanticTransferValidation } from "../core/telemetry.js";
import { firstNormalizedString } from "../core/compact.js";

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
      const name = firstNormalizedString(source?.name, `detail-${index + 1}`);
      const path = firstNormalizedString(
        source?.transferFilePath,
        source?.filePath,
        source?.relativePath,
        source?.sandboxPath,
      );
      return path ? { name, path } : null;
    })
    .filter(Boolean);
}

export async function transferAgentPluginStageMessage({
  runtime = {},
  agentContext = null,
  summary = "",
  detail = "",
  name = "agent-plugin-stage-detail.md",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "agent_plugin_stage_message",
  source = "plugin",
  reason = "agent_plugin_stage_message",
  meta = {},
} = {}) {
  const normalizedSummary = String(summary || "").trim();
  const normalizedDetail = String(detail || "").trim();
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.PLUGIN,
    fallbackReason: TRANSFER_REASON.AGENT_PLUGIN_STAGE_MESSAGE,
    defaultGenerationSource: TRANSFER_REASON.AGENT_PLUGIN_STAGE_MESSAGE,
    allowCustom: true,
  });

  if (!normalizedDetail) {
    await emitSemanticTransferValidation({
      runtime,
      scenario: "agent_plugin_stage_message",
      stats: {
        inputCount: 0,
        outputCount: 0,
        filteredCount: 0,
        invalidCount: 0,
        strict: Boolean(
          runtime?.userConfig?.semanticTransfer?.strictEnvelopeValidation ??
            runtime?.globalConfig?.semanticTransfer?.strictEnvelopeValidation,
        ),
        enforceProtocol: true,
      },
    });
    return { transferEnvelopes: [] };
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: normalizedDetail,
    name: firstNormalizedString(name, "agent-plugin-stage-detail.md"),
    mimeType: firstNormalizedString(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
    attachmentSource,
    generationSource: intent.generationSource,
    source: intent.source,
    reason: intent.reason,
    meta: {
      ...(isPlainObject(meta) ? meta : {}),
      summary: normalizedSummary,
      detailLength: normalizedDetail.length,
    },
  });

  const transferEnvelopesResult = normalizeTransferEnvelopesWithPolicy(
    Array.isArray(persisted?.transferEnvelopes) ? persisted.transferEnvelopes : [],
    { runtime, enforceProtocol: true, withStats: true },
  );
  const transferEnvelopes = transferEnvelopesResult?.envelopes || [];
  await emitSemanticTransferValidation({
    runtime,
    scenario: "agent_plugin_stage_message",
    stats: transferEnvelopesResult?.stats || {},
  });
  return { transferEnvelopes };
}

export function composeAgentPluginFinalMessage({
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
