/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_REASON,
} from "../core/constants.js";
import {
  createTransferEnvelope,
  decideTransfer,
  directTransfer,
  TRANSFER_DIRECTION,
  TRANSFER_MODE,
  TRANSFER_SOURCE,
  getToolInputPolicy,
} from "@noobot/semantic-transfer-protocol";
import { resolveTransferIntent } from "../core/intent.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import { firstNormalizedString } from "../core/compact.js";
import {
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeRawString(value = "") {
  return String(value || "");
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSafePositiveInt(value, fallback = 0, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Number(fallback || 0));
  return Math.max(min, Math.floor(parsed));
}

function resolveToolInputOverflowFromCall(call = {}) {
  const toolName = normalizeString(call?.name);
  const args = isPlainObject(call?.args) ? call.args : {};
  const policy = getToolInputPolicy(toolName, args);
  if (!policy) return null;
  const text = normalizeRawString(args?.[policy.field]);
  const maxChars = Number(policy.maxChars || 0);
  const exceeded = text.length > maxChars;
  const forceAttachment = policy.forceAttachment === true;
  if (!exceeded && !forceAttachment) return null;
  const policyMeta =
    toolName === "write_file"
      ? { targetPath: normalizeString(args?.filePath) }
      : {};
  return {
    toolName,
    field: policy.field,
    text,
    maxChars,
    exceeded,
    forceAttachment,
    message: policy.message,
    name:
      typeof policy.name === "function"
        ? policy.name({ call, args })
        : "tool-input.txt",
    mimeType: policy.mimeType || DEFAULT_TRANSFER_MIME_TYPE,
    source: TRANSFER_SOURCE.TOOL,
    reason: policy.reason,
    meta: {
      toolName,
      field: policy.field,
      ...policyMeta,
    },
  };
}

function buildToolInputTransferMeta({
  baseMeta = {},
  normalizedText = "",
  resolvedMimeType = DEFAULT_TRANSFER_MIME_TYPE,
  intent = {},
  callOverflow = null,
  exceeded = false,
} = {}) {
  const textLength = String(normalizedText || "").length;
  const isExceeded = exceeded === true || callOverflow?.exceeded === true;
  return {
    ...(baseMeta && typeof baseMeta === "object" && !Array.isArray(baseMeta)
      ? baseMeta
      : {}),
    source: intent.source,
    reason: intent.reason,
    mimeType: resolvedMimeType,
    originalLength: textLength,
    textLength,
    exceeded: isExceeded,
    toolInputOverflow: callOverflow
      ? {
          toolName: callOverflow.toolName,
          field: callOverflow.field,
          exceeded: callOverflow.exceeded,
          forceAttachment: callOverflow.forceAttachment,
          maxChars: callOverflow.maxChars,
          message: callOverflow.message,
          textLength,
        }
      : undefined,
    ...(callOverflow?.message ? { message: callOverflow.message } : {}),
  };
}

async function buildTransferResponse({ transferEnvelopes = [] } = {}) {
  return {
    transferEnvelopes: Array.isArray(transferEnvelopes)
      ? transferEnvelopes
      : [],
  };
}

export async function transferToolOutput({
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
  previewChars = LENGTH_THRESHOLDS.semanticTransfer.previewChars,
  forcePreview = false,
  identity = null,
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
  const maxInline =
    inlineMaxChars == null
      ? resolveToolResultInlineTextLimit(runtime)
      : toSafePositiveInt(
          inlineMaxChars,
          resolveToolResultInlineTextLimit(runtime),
          0,
        );
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text: normalizedText,
    name,
    mimeType,
    attachmentSource,
    generationSource: intent.generationSource,
    source: intent.source,
    reason: intent.reason,
    storage,
    producer,
    identity,
    meta,
    scenario: "tool",
    strategy: "tool_output",
    alwaysPersist: forceAttachment === true,
    inlineMaxChars: maxInline,
    previewChars,
    forcePreview,
  });

  const persistedTransferEnvelopes = Array.isArray(
    materialized?.transferEnvelopes,
  )
    ? materialized.transferEnvelopes
    : [];
  const transferEnvelopes = persistedTransferEnvelopes;

  return await buildTransferResponse({
    transferEnvelopes,
  });
}

export async function transferToolInput({
  runtime = {},
  agentContext = null,
  call = null,
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
  identity = null,
} = {}) {
  const hasExplicitText = text !== "" || content !== "";
  const callOverflow =
    !hasExplicitText && call ? resolveToolInputOverflowFromCall(call) : null;
  if (!hasExplicitText && call && !callOverflow) {
    return {
      transferEnvelopes: [],
    };
  }
  const normalizedText = callOverflow
    ? callOverflow.text
    : String(text || content || "");
  const resolvedName = callOverflow?.name || name;
  const resolvedMimeType = callOverflow?.mimeType || mimeType;
  const resolvedSource = callOverflow?.source || source;
  const resolvedReason = callOverflow?.reason || reason;
  const resolvedMeta = {
    ...(meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}),
    ...(callOverflow?.meta || {}),
  };
  const intent = resolveTransferIntent({
    source: resolvedSource,
    reason: resolvedReason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
    defaultGenerationSource: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
    allowCustom: true,
  });
  const resolvedInlineLimit =
    inlineMaxChars == null
      ? (callOverflow?.maxChars ?? resolveToolResultInlineTextLimit(runtime))
      : inlineMaxChars;
  const maxInline = toSafePositiveInt(
    resolvedInlineLimit,
    resolveToolResultInlineTextLimit(runtime),
    0,
  );
  const decision = decideTransfer({
    content: normalizedText,
    forceAttachment: forceAttachment === true || callOverflow?.forceAttachment === true,
    policy: { maxDirectChars: maxInline },
  });
  const inputExceeded =
    callOverflow?.exceeded === true || decision.reason === "threshold_exceeded";

  if (decision.mode === TRANSFER_MODE.DIRECT) {
    const envelopeMeta = buildToolInputTransferMeta({
      baseMeta: resolvedMeta,
      normalizedText,
      resolvedMimeType,
      intent,
      callOverflow,
      exceeded: inputExceeded,
    });
    const envelope = directTransfer({
      transferId: identity.transferId,
      messageId: identity.messageId,
      identity,
      direction: TRANSFER_DIRECTION.INPUT,
      content: normalizedText,
      intent: {
        source: intent.source,
        reason: intent.reason,
        scenario: "tool",
        strategy: "tool_input",
      },
      meta: {
        mimeType: resolvedMimeType,
        originalLength: normalizedText.length,
        previewLength: normalizedText.length,
      },
    });
    return await buildTransferResponse({
      transferEnvelopes: [envelope],
    });
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: normalizedText,
    name: firstNormalizedString(resolvedName, "tool-input.txt"),
    mimeType: firstNormalizedString(
      resolvedMimeType,
      DEFAULT_TRANSFER_MIME_TYPE,
    ),
    attachmentSource,
    generationSource: intent.generationSource,
    source: intent.source,
    reason: intent.reason,
    storage,
    producer,
    identity,
    direction: TRANSFER_DIRECTION.INPUT,
    intent: {
      source: intent.source,
      reason: intent.reason,
      scenario: "tool",
      strategy: "tool_input",
    },
    meta: {
      mimeType: resolvedMimeType,
      originalLength: normalizedText.length,
      attributes: buildToolInputTransferMeta({
        baseMeta: resolvedMeta,
        normalizedText,
        resolvedMimeType,
        intent,
        callOverflow,
        exceeded: inputExceeded,
      }),
    },
  });

  const transferEnvelopes = persisted?.transferEnvelopes || [];

  return await buildTransferResponse({
    transferEnvelopes,
  });
}
