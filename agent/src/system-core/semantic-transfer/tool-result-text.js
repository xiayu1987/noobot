/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE } from "./constants.js";
import { persistTransferFile } from "./attachment-adapter.js";

const DEFAULT_INLINE_TEXT_CHARS = 10000;
const DEFAULT_PREVIEW_CHARS = 1200;

function normalizeString(value = "") {
  return String(value || "").trim();
}

function toSafePositiveInt(value, fallback = DEFAULT_INLINE_TEXT_CHARS, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

export function resolveToolResultInlineTextLimit(runtime = {}, fallback = DEFAULT_INLINE_TEXT_CHARS) {
  const userLimit = runtime?.userConfig?.tools?.maxToolResultChars;
  const globalLimit = runtime?.globalConfig?.tools?.maxToolResultChars;
  return toSafePositiveInt(userLimit ?? globalLimit, fallback, 512);
}

export function buildTextResultFields({
  text = "",
  transferEnvelopes = [],
  inlineMaxChars = DEFAULT_INLINE_TEXT_CHARS,
  previewChars = DEFAULT_PREVIEW_CHARS,
  forcePreview = false,
} = {}) {
  const normalizedText = String(text || "");
  const normalizedTransferEnvelopes = Array.isArray(transferEnvelopes)
    ? transferEnvelopes.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
  const maxInline = toSafePositiveInt(inlineMaxChars, DEFAULT_INLINE_TEXT_CHARS, 0);
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
    ...(normalizedTransferEnvelopes.length ? { transferEnvelopes: normalizedTransferEnvelopes } : {}),
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
} = {}) {
  const normalizedText = String(text || "");
  const maxInline = inlineMaxChars == null
    ? resolveToolResultInlineTextLimit(runtime)
    : toSafePositiveInt(inlineMaxChars, DEFAULT_INLINE_TEXT_CHARS, 0);
  const shouldPersist = alwaysPersist || normalizedText.length > maxInline;
  let persisted = null;
  if (shouldPersist) {
    persisted = await persistTransferFile({
      runtime,
      agentContext,
      content: normalizedText,
      name: normalizeString(name) || "tool-result.txt",
      mimeType: normalizeString(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
      attachmentSource,
      generationSource: generationSource || reason || source || "semantic_transfer_tool_result",
      source,
      reason,
      storage,
      producer,
      meta: {
        ...meta,
        originalLength: normalizedText.length,
      },
    });
  }

  const transferEnvelope =
    persisted?.envelope && typeof persisted.envelope === "object" && !Array.isArray(persisted.envelope)
      ? persisted.envelope
      : persisted?.result?.envelope && typeof persisted.result.envelope === "object" && !Array.isArray(persisted.result.envelope)
        ? persisted.result.envelope
        : null;
  const transferEnvelopes = transferEnvelope ? [transferEnvelope] : [];
  const resultFields = buildTextResultFields({
    text: normalizedText,
    transferEnvelopes,
    inlineMaxChars: maxInline,
    previewChars,
    forcePreview,
  });

  return {
    resultFields,
    transferEnvelope,
    transferEnvelopes,
    persisted,
  };
}
