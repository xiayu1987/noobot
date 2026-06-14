/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_DIRECTION,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
} from "../core/constants.js";
import { createTransferEnvelope, directInput, directOutput } from "../envelope/envelope.js";
import {
  extractTransferEnvelopeFromPersisted,
  normalizeTransferEnvelopes,
  normalizeTransferEnvelopesWithPolicy,
} from "../envelope/envelope-utils.js";
import { resolveTransferIntent } from "../core/intent.js";
import { emitSemanticTransferValidation } from "../core/telemetry.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "../core/result.js";
import {
  compactToolResultPayloadForModel,
  compactTransferPayloadForModel,
  firstNormalizedString,
} from "../core/compact.js";
import {
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { normalizeToolResultOverflow } from "./tool-result-overflow.js";

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

async function buildTransferResponse({
  transferResult = null,
  transferEnvelopes = [],
  passthrough = {},
  runtime = {},
  scenario = "tool",
} = {}) {
  const normalizedResult = normalizeTransferEnvelopesWithPolicy(
    Array.isArray(transferEnvelopes) ? transferEnvelopes : [],
    {
      runtime,
      enforceProtocol: true,
      withStats: true,
    },
  );
  const normalizedEnvelopes = Array.isArray(normalizedResult?.envelopes)
    ? normalizedResult.envelopes
    : [];
  const validationStats = normalizedResult?.stats || {};
  const transferValidation = {
    strict: Boolean(validationStats.strict),
    enforceProtocol: Boolean(validationStats.enforceProtocol),
    inputCount: Number(validationStats.inputCount || 0),
    outputCount: Number(validationStats.outputCount || normalizedEnvelopes.length),
    filteredCount: Number(validationStats.filteredCount || 0),
    invalidCount: Number(validationStats.invalidCount || 0),
  };
  const payload = {
    transferResult,
    transferEnvelopes: normalizedEnvelopes,
    compactTransferPayload: compactTransferPayloadForModel({
      transferResult,
      transferEnvelopes: normalizedEnvelopes,
    }),
    transferValidation,
    ...passthrough,
  };
  await emitSemanticTransferValidation({
    runtime,
    scenario,
    stats: validationStats,
    transferValidation,
  });
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
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_OUTPUT,
    defaultGenerationSource: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_OUTPUT,
    allowCustom: true,
  });
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
    generationSource: intent.generationSource,
    source: intent.source,
    reason: intent.reason,
    storage,
    producer,
    meta,
    alwaysPersist: forceAttachment === true,
    inlineMaxChars: maxInline,
    previewChars,
    forcePreview,
  });

  const persistedTransferEnvelopes = normalizeTransferEnvelopes(
    Array.isArray(materialized?.transferEnvelopes) ? materialized.transferEnvelopes : [],
  );
  const directEnvelope = directOutput(normalizedText, {
    ...meta,
    source: intent.source,
    reason: intent.reason,
  });
  const persistedEnvelope = persistedTransferEnvelopes[0] || null;
  const transferEnvelopes = persistedEnvelope ? persistedTransferEnvelopes : [directEnvelope];

  return await buildTransferResponse({
    transferResult: persistedEnvelope
      ? createTransferResult({
          ok: true,
          status: TRANSFER_RESULT_STATUS.FILE,
          envelope: persistedEnvelope,
        })
      : createTransferResult({
          ok: true,
          status: TRANSFER_RESULT_STATUS.DIRECT,
          envelope: directEnvelope,
        }),
    transferEnvelopes,
    passthrough: {
      ...(materialized?.resultFields && typeof materialized.resultFields === "object"
        ? materialized.resultFields
        : {}),
      exceeded: normalizedText.length > maxInline || forceAttachment === true,
      textLength: normalizedText.length,
    },
    runtime,
    scenario: "tool_output",
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
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
    defaultGenerationSource: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
    allowCustom: true,
  });
  const resolvedInlineLimit = inlineMaxChars == null
    ? resolveToolResultInlineTextLimit(runtime)
    : inlineMaxChars;
  const maxInline = toSafePositiveInt(resolvedInlineLimit, resolveToolResultInlineTextLimit(runtime), 0);
  const shouldPersist = forceAttachment === true || normalizedText.length > maxInline;

  if (!shouldPersist) {
    const envelope = directInput(normalizedText, {
      ...meta,
      source: intent.source,
      reason: intent.reason,
      mimeType,
      originalLength: normalizedText.length,
    });
    return await buildTransferResponse({
      transferResult: createTransferResult({
        ok: true,
        status: TRANSFER_RESULT_STATUS.DIRECT,
        envelope,
      }),
      transferEnvelopes: [envelope],
      passthrough: {
        inlineContent: normalizedText,
        exceeded: false,
        textLength: normalizedText.length,
      },
      runtime,
      scenario: "tool_input",
    });
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: normalizedText,
    name: firstNormalizedString(name, "tool-input.txt"),
    mimeType: firstNormalizedString(mimeType, DEFAULT_TRANSFER_MIME_TYPE),
    attachmentSource,
    generationSource: intent.generationSource,
    source: intent.source,
    reason: intent.reason,
    storage,
    producer,
    meta: {
      ...meta,
      originalLength: normalizedText.length,
    },
  });

  const outputEnvelope = extractTransferEnvelopeFromPersisted(persisted);
  const transferEnvelopes = normalizeTransferEnvelopes(
    outputEnvelope ? [remapEnvelopeDirection(outputEnvelope, TRANSFER_DIRECTION.INPUT)] : [],
  );
  const persistedEnvelope = transferEnvelopes[0] || null;

  return await buildTransferResponse({
    transferResult: persistedEnvelope
      ? createTransferResult({
          ok: true,
          status: TRANSFER_RESULT_STATUS.FILE,
          envelope: persistedEnvelope,
        })
      : createTransferResult({
          ok: false,
          status: TRANSFER_RESULT_STATUS.FAILED,
          error: {
            code: "TRANSFER_PERSIST_FAILED",
            message: "failed to persist tool input",
          },
        }),
    transferEnvelopes,
    passthrough: {
      exceeded: true,
      textLength: normalizedText.length,
      inlineContent: "",
    },
    runtime,
    scenario: "tool_input",
  });
}

export async function transferToolMessage({
  direction = TRANSFER_DIRECTION.OUTPUT,
  transferMode = "",
  mode = "",
  ...options
} = {}) {
  const normalizedMode = firstNormalizedString(transferMode, mode);
  if (normalizedMode === "tool_result_text") {
    return normalizeToolResultOverflow({
      ...options,
      toolResultText: options.toolResultText ?? options.text ?? options.content ?? "",
    });
  }

  const normalizedDirection = normalizeDirection(direction);
  if (normalizedDirection === TRANSFER_DIRECTION.INPUT) {
    return transferToolInput(options);
  }
  return transferToolOutput(options);
}
