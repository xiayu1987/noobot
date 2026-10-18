/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { firstText, isPlainObject, text } from "@noobot/shared/value";
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  resolveTransferIntent,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import { emitSemanticTransferValidation } from "../core/validation-events.js";
import { tSystem } from "noobot-i18n/agent/system-text";

export async function transferAgentPluginStageMessage({
  runtime = {},
  summary = "",
  detail = "",
  name = "agent-plugin-stage-detail.md",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "harness_summary",
  source = "plugin",
  reason = "harness_summary",
  strategy = "harness_summary",
  category = "",
  businessPoint = "",
  meta = {},
  identity = null,
} = {}) {
  const normalizedSummary = text(summary);
  const normalizedDetail = text(detail);
  const intent = resolveTransferIntent({
    source,
    reason,
    fallbackSource: TRANSFER_SOURCE.PLUGIN,
    fallbackReason: TRANSFER_REASON.HARNESS_SUMMARY,
  });

  if (!normalizedDetail) {
    await emitSemanticTransferValidation({
      runtime,
      scenario: "harness",
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
    content: normalizedDetail,
    name: firstText(name, "agent-plugin-stage-detail.md"),
    mimeType: firstText(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
    attachmentSource,
    identity,
    generationSource,
    source: intent.source,
    reason: intent.reason,
    intent: {
      source: intent.source,
      reason: intent.reason,
      scenario: "harness",
      strategy,
      ...(category ? { category } : {}),
      ...(businessPoint ? { businessPoint } : {}),
    },
    meta: {
      ...(isPlainObject(meta) ? meta : {}),
      summary: normalizedSummary,
      detailLength: normalizedDetail.length,
    },
  });

  const transferEnvelopes = Array.isArray(persisted?.transferEnvelopes)
    ? persisted.transferEnvelopes
    : [];
  transferEnvelopes.forEach((envelope) => validateTransferEnvelope(envelope, { strict: true }));
  await emitSemanticTransferValidation({
    runtime,
    scenario: "harness",
    stats: {
      inputCount: transferEnvelopes.length,
      outputCount: transferEnvelopes.length,
      enforceProtocol: true,
    },
  });
  return { transferEnvelopes };
}

export function composeAgentPluginFinalMessage({
  resultInfo = "",
  detailEnvelopes = [],
  validationInfo = "",
  header = "",
  locale,
} = {}) {
  const resultText = text(resultInfo);
  const validationText = text(validationInfo);
  const detailLines = (Array.isArray(detailEnvelopes) ? detailEnvelopes : [])
    .flatMap((envelope = {}) =>
      Array.isArray(envelope?.payload?.attachments) ? envelope.payload.attachments : [],
    )
    .map((item = {}) => `- ${firstText(item.name, item.identity?.attachmentId)}`);

  return [
    text(header),
    resultText,
    detailLines.length ? tSystem("transfer.pluginDetailAttachments", locale) : "",
    ...detailLines,
    validationText ? tSystem("transfer.pluginValidationInfo", locale) : "",
    validationText,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
