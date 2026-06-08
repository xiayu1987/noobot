/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_DIRECTION } from "./constants.js";
import { createTransferEnvelope, directInput, directOutput } from "./envelope.js";
import { persistTransferFile } from "./attachment-adapter.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "./result.js";
import {
  compactToolResultPayloadForModel,
  compactTransferPayloadForModel,
} from "./compact.js";
import {
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function toSafePositiveInt(value, fallback = 0, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

function normalizeDirection(value = TRANSFER_DIRECTION.OUTPUT) {
  const normalized = normalizeString(value);
  if (normalized === TRANSFER_DIRECTION.INPUT) return TRANSFER_DIRECTION.INPUT;
  return TRANSFER_DIRECTION.OUTPUT;
}

function remapEnvelopeDirection(envelope = {}, direction = TRANSFER_DIRECTION.OUTPUT) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  if (normalizeString(envelope.direction) === direction) return envelope;
  return createTransferEnvelope({
    ...envelope,
    direction,
  });
}

function buildTransferResponse({
  transferResult = null,
  transferEnvelope = null,
  transferEnvelopes = [],
  passthrough = {},
} = {}) {
  const normalizedEnvelope =
    transferEnvelope && typeof transferEnvelope === "object" && !Array.isArray(transferEnvelope)
      ? transferEnvelope
      : null;
  const normalizedEnvelopes = Array.isArray(transferEnvelopes)
    ? transferEnvelopes.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : normalizedEnvelope
      ? [normalizedEnvelope]
      : [];
  const payload = {
    transferResult,
    transferEnvelope: normalizedEnvelope,
    transferEnvelopes: normalizedEnvelopes,
    compactTransferPayload: compactTransferPayloadForModel({
      transferResult,
      transferEnvelope: normalizedEnvelope,
      transferEnvelopes: normalizedEnvelopes,
    }),
    ...passthrough,
  };
  return {
    ...payload,
    compactToolPayload: compactToolResultPayloadForModel(payload),
  };
}

async function transferToolOutput({
  runtime = {},
  agentContext = null,
  text = "",
  content = "",
  name = "tool-result.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_tool_output",
  source = "tool",
  reason = "semantic_transfer_tool_output",
  storage = null,
  producer = null,
  meta = {},
  forceAttachment = false,
  inlineMaxChars = null,
  previewChars = 1200,
  forcePreview = false,
} = {}) {
  const normalizedText = String(text || content || "");
  const maxInline = inlineMaxChars == null
    ? resolveToolResultInlineTextLimit(runtime)
    : toSafePositiveInt(inlineMaxChars, resolveToolResultInlineTextLimit(runtime), 0);
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text: normalizedText,
    name,
    mimeType,
    attachmentSource,
    generationSource,
    source,
    reason,
    storage,
    producer,
    meta,
    alwaysPersist: forceAttachment === true,
    inlineMaxChars: maxInline,
    previewChars,
    forcePreview,
  });

  const transferEnvelope =
    materialized?.transferEnvelope &&
    typeof materialized.transferEnvelope === "object" &&
    !Array.isArray(materialized.transferEnvelope)
      ? materialized.transferEnvelope
      : null;
  const persistedTransferEnvelopes = Array.isArray(materialized?.transferEnvelopes)
    ? materialized.transferEnvelopes
    : transferEnvelope
      ? [transferEnvelope]
      : [];
  const directEnvelope = directOutput(normalizedText, meta);
  const effectiveEnvelope = transferEnvelope || directEnvelope;
  const transferEnvelopes = transferEnvelope ? persistedTransferEnvelopes : [directEnvelope];

  return buildTransferResponse({
    transferResult: transferEnvelope
      ? createTransferResult({
          ok: true,
          status: TRANSFER_RESULT_STATUS.FILE,
          envelope: transferEnvelope,
        })
      : createTransferResult({
          ok: true,
          status: TRANSFER_RESULT_STATUS.DIRECT,
          envelope: directEnvelope,
        }),
    transferEnvelope: effectiveEnvelope,
    transferEnvelopes,
    passthrough: {
      ...(materialized?.resultFields && typeof materialized.resultFields === "object"
        ? materialized.resultFields
        : {}),
      exceeded: normalizedText.length > maxInline || forceAttachment === true,
      textLength: normalizedText.length,
    },
  });
}

async function transferToolInput({
  runtime = {},
  agentContext = null,
  text = "",
  content = "",
  name = "tool-input.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_tool_input",
  source = "tool",
  reason = "semantic_transfer_tool_input",
  storage = null,
  producer = null,
  meta = {},
  forceAttachment = false,
  inlineMaxChars = null,
} = {}) {
  const normalizedText = String(text || content || "");
  const resolvedInlineLimit = inlineMaxChars == null
    ? resolveToolResultInlineTextLimit(runtime)
    : inlineMaxChars;
  const maxInline = toSafePositiveInt(resolvedInlineLimit, resolveToolResultInlineTextLimit(runtime), 0);
  const shouldPersist = forceAttachment === true || normalizedText.length > maxInline;

  if (!shouldPersist) {
    const envelope = directInput(normalizedText, {
      ...meta,
      source,
      reason,
      mimeType,
      originalLength: normalizedText.length,
    });
    return buildTransferResponse({
      transferResult: createTransferResult({
        ok: true,
        status: TRANSFER_RESULT_STATUS.DIRECT,
        envelope,
      }),
      transferEnvelope: envelope,
      transferEnvelopes: [envelope],
      passthrough: {
        inlineContent: normalizedText,
        exceeded: false,
        textLength: normalizedText.length,
      },
    });
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: normalizedText,
    name: normalizeString(name) || "tool-input.txt",
    mimeType: normalizeString(mimeType) || DEFAULT_TRANSFER_MIME_TYPE,
    attachmentSource,
    generationSource: generationSource || reason || source || "semantic_transfer_tool_input",
    source,
    reason,
    storage,
    producer,
    meta: {
      ...meta,
      originalLength: normalizedText.length,
    },
  });

  const outputEnvelope =
    persisted?.envelope && typeof persisted.envelope === "object" && !Array.isArray(persisted.envelope)
      ? persisted.envelope
      : persisted?.result?.envelope && typeof persisted.result.envelope === "object" && !Array.isArray(persisted.result.envelope)
        ? persisted.result.envelope
        : null;
  const transferEnvelope = remapEnvelopeDirection(outputEnvelope, TRANSFER_DIRECTION.INPUT);
  const transferEnvelopes = transferEnvelope ? [transferEnvelope] : [];

  return buildTransferResponse({
    transferResult: transferEnvelope
      ? createTransferResult({
          ok: true,
          status: TRANSFER_RESULT_STATUS.FILE,
          envelope: transferEnvelope,
        })
      : createTransferResult({
          ok: false,
          status: TRANSFER_RESULT_STATUS.FAILED,
          error: {
            code: "TRANSFER_PERSIST_FAILED",
            message: "failed to persist tool input",
          },
        }),
    transferEnvelope,
    transferEnvelopes,
    passthrough: {
      exceeded: true,
      textLength: normalizedText.length,
      inlineContent: "",
    },
  });
}

export async function transferToolMessage({ direction = TRANSFER_DIRECTION.OUTPUT, ...options } = {}) {
  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === TRANSFER_DIRECTION.INPUT) {
    return transferToolInput(options);
  }
  return transferToolOutput(options);
}
