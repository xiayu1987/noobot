/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_REASON } from "../core/constants.js";
import {
  decideTransfer,
  normalizeTransferEnvelopes,
  TRANSFER_MODE,
  TRANSFER_SOURCE,
} from "@noobot/semantic-transfer-protocol";
import { firstNormalizedString } from "../core/compact.js";
import { resolveTransferIntent } from "../core/intent.js";
import {
  createDirectTransferEnvelope,
  persistTransferFile,
} from "../storage/attachment-adapter.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS =
  LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars;
const DEFAULT_PREVIEW_CHARS = LENGTH_THRESHOLDS.semanticTransfer.previewChars;

function normalizeString(value = "") {
  return String(value || "").trim();
}

function toSafePositiveInt(value, fallback = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

export function resolveToolResultInlineTextLimit(
  runtime = {},
  fallback = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
) {
  const userLimit = runtime?.userConfig?.tools?.maxToolResultChars;
  const globalLimit = runtime?.globalConfig?.tools?.maxToolResultChars;
  return toSafePositiveInt(userLimit ?? globalLimit, fallback, 512);
}

export function buildTextResultFields({
  text = "",
  transferEnvelopes = [],
  inlineMaxChars = DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  previewChars = DEFAULT_PREVIEW_CHARS,
  forcePreview = false,
  sessionId = "",
  identity = null,
  scenario = "tool",
  strategy = "tool_result_text",
} = {}) {
  const normalizedText = String(text || "");
  const normalizedTransferEnvelopes = normalizeTransferEnvelopes(transferEnvelopes);
  const maxInline = toSafePositiveInt(inlineMaxChars, DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS, 0);
  const maxPreview = toSafePositiveInt(previewChars, DEFAULT_PREVIEW_CHARS, 0);
  const shouldInline = !forcePreview && normalizedText.length <= maxInline;
  const textPayload = shouldInline
    ? { text: normalizedText }
    : {
        textPreview: normalizedText.slice(0, maxPreview),
        textPreviewLength: Math.min(normalizedText.length, maxPreview),
        textPreviewTruncated: normalizedText.length > maxPreview,
      };
  return {
    ...textPayload,
    textLength: normalizedText.length,
    contentStoredInFile: normalizedTransferEnvelopes.length > 0,
    ...(normalizedTransferEnvelopes.length
      ? { transferEnvelopes: normalizedTransferEnvelopes }
      : {}),
  };
}

export async function materializeTextForToolResult({
  runtime = {},
  agentContext = null,
  text = "",
  name = "tool-result.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_tool_result",
  source = "tool",
  reason = "semantic_transfer_tool_result",
  storage = null,
  producer = null,
  meta = {},
  alwaysPersist = false,
  inlineMaxChars = null,
  previewChars = DEFAULT_PREVIEW_CHARS,
  forcePreview = false,
  sessionId = "",
  identity = null,
  scenario = "tool",
  strategy = "tool_result_text",
} = {}) {
  const normalizedText = String(text || "");
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
    defaultGenerationSource: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
    allowCustom: true,
  });
  const maxInline =
    inlineMaxChars == null
      ? resolveToolResultInlineTextLimit(runtime)
      : toSafePositiveInt(inlineMaxChars, DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS, 0);
  const decision = decideTransfer({
    content: normalizedText,
    forceAttachment: alwaysPersist,
    policy: { maxDirectChars: maxInline },
  });
  let persisted = null;
  if (decision.mode === TRANSFER_MODE.ATTACHMENT) {
    persisted = await persistTransferFile({
      runtime,
      agentContext,
      content: normalizedText,
      name: firstNormalizedString(name, "tool-result.txt"),
      mimeType: firstNormalizedString(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
      attachmentSource,
      generationSource: intent.generationSource,
      source: intent.source,
      reason: intent.reason,
      intent: { source: intent.source, reason: intent.reason, scenario, strategy },
      storage,
      identity,
      producer,
      meta: {
        ...(Object.keys(meta || {}).length ? { attributes: meta } : {}),
        originalLength: normalizedText.length,
      },
    });
  }

  const persistedTransferEnvelopes = normalizeTransferEnvelopes(
    persisted?.transferEnvelopes,
  );
  if (decision.mode === TRANSFER_MODE.ATTACHMENT && !persistedTransferEnvelopes.length) {
    throw new Error("semantic_transfer_attachment_persistence_required");
  }
  const transferEnvelopes = decision.mode === TRANSFER_MODE.ATTACHMENT
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
    persisted,
  };
}
