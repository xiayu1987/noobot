/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  decideTransfer,
  DEFAULT_TRANSFER_MIME_TYPE,
  normalizeTransferEnvelopes,
  previewTransferText,
  requireTransferCharLimit,
  resolveTransferIntent,
  TRANSFER_MODE,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
} from "@noobot/semantic-transfer-protocol";
import { firstText } from "@noobot/shared/value";
import {
  createDirectTransferEnvelope,
  persistTransferFile,
} from "../storage/attachment-adapter.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS =
  LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars;
const DEFAULT_PREVIEW_CHARS = LENGTH_THRESHOLDS.semanticTransfer.previewChars;

export function resolveToolResultInlineTextLimit(
  runtime = {},
  fallback = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
) {
  const userLimit = runtime?.userConfig?.tools?.maxToolResultChars;
  const globalLimit = runtime?.globalConfig?.tools?.maxToolResultChars;
  const limit = userLimit === undefined ? globalLimit : userLimit;
  return requireTransferCharLimit(limit === undefined ? fallback : limit);
}

function buildTextResultFields({
  text = "",
  transferEnvelopes = [],
  inlineMaxChars = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  previewChars = DEFAULT_PREVIEW_CHARS,
  forcePreview = false,
} = {}) {
  const normalizedText = String(text || "");
  const normalizedTransferEnvelopes = normalizeTransferEnvelopes(transferEnvelopes);
  const maxInline = requireTransferCharLimit(inlineMaxChars);
  const preview = previewTransferText(normalizedText, previewChars);
  const shouldInline = !forcePreview && normalizedText.length <= maxInline;
  const textPayload = shouldInline
    ? { text: normalizedText }
    : {
        textPreview: preview,
        textPreviewLength: preview.length,
        textPreviewTruncated: normalizedText.length > preview.length,
      };
  return {
    ...textPayload,
    textLength: normalizedText.length,
    ...(normalizedTransferEnvelopes.length
      ? { transferEnvelopes: normalizedTransferEnvelopes }
      : {}),
  };
}

export async function materializeTextForToolResult({
  runtime = {},
  text = "",
  name = "tool-result.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_tool_result",
  source = "tool",
  reason = "semantic_transfer_tool_result",
  meta = {},
  alwaysPersist = false,
  inlineMaxChars = null,
  previewChars = DEFAULT_PREVIEW_CHARS,
  forcePreview = false,
  identity = null,
  scenario = "tool",
  strategy = "tool_result_text",
} = {}) {
  const normalizedText = String(text || "");
  const intent = resolveTransferIntent({
    source,
    reason,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
  });
  const maxInline =
    inlineMaxChars == null
      ? resolveToolResultInlineTextLimit(runtime)
      : requireTransferCharLimit(inlineMaxChars);
  const decision = decideTransfer({
    content: normalizedText,
    forceAttachment: alwaysPersist,
    policy: { maxDirectChars: maxInline },
  });
  let persisted = null;
  if (decision.mode === TRANSFER_MODE.ATTACHMENT) {
    persisted = await persistTransferFile({
      runtime,
      content: normalizedText,
      name: firstText(name, "tool-result.txt"),
      mimeType: firstText(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
      attachmentSource,
      generationSource,
      source: intent.source,
      reason: intent.reason,
      intent: { source: intent.source, reason: intent.reason, scenario, strategy },
      identity,
      meta: {
        ...(Object.keys(meta || {}).length ? { attributes: meta } : {}),
        originalLength: normalizedText.length,
      },
    });
  }

  const persistedTransferEnvelopes = normalizeTransferEnvelopes(persisted?.transferEnvelopes);
  if (decision.mode === TRANSFER_MODE.ATTACHMENT && !persistedTransferEnvelopes.length) {
    throw new Error("semantic_transfer_attachment_persistence_required");
  }
  const transferEnvelopes =
    decision.mode === TRANSFER_MODE.ATTACHMENT
      ? persistedTransferEnvelopes
      : [
          createDirectTransferEnvelope({
            identity,
            content: normalizedText,
            intent: {
              source: intent.source,
              reason: intent.reason,
              scenario,
              strategy,
            },
            meta: {
              mimeType,
              originalLength: normalizedText.length,
              previewLength: normalizedText.length,
            },
          }),
        ];
  const resultFields = buildTextResultFields({
    text: normalizedText,
    transferEnvelopes,
    inlineMaxChars: maxInline,
    previewChars,
    forcePreview,
  });

  return {
    resultFields,
    transferEnvelopes,
  };
}
