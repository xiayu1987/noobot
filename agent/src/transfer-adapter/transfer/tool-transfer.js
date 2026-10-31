/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { firstText, isPlainObject, text } from "@noobot/shared/value";
import {
  decideTransfer,
  DEFAULT_TRANSFER_MIME_TYPE,
  directTransfer,
  requireTransferCharLimit,
  resolveTransferIntent,
  TRANSFER_DIRECTION,
  TRANSFER_MODE,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  getToolInputPolicy,
} from "@noobot/semantic-transfer-protocol";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import {
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { tTool } from "../../tools/core/tool-i18n.js";

function normalizeRawString(value = "") {
  return String(value || "");
}

function resolveToolInputOverflowFromCall(call = {}, runtime = {}) {
  const toolName = text(call?.name);
  const args = isPlainObject(call?.args) ? call.args : {};
  const policy = getToolInputPolicy(toolName, args);
  if (!policy) return null;
  const inputText = normalizeRawString(args?.[policy.field]);
  const maxChars = Number(policy.maxChars || 0);
  const exceeded = inputText.length > maxChars;
  const forceAttachment = policy.forceAttachment === true;
  if (!exceeded && !forceAttachment) return null;
  const policyMeta = toolName === "write_file" ? { targetPath: text(args?.filePath) } : {};
  return {
    toolName,
    field: policy.field,
    text: inputText,
    maxChars,
    exceeded,
    forceAttachment,
    message: tTool(runtime, policy.messageKey),
    name: typeof policy.name === "function" ? policy.name({ call, args }) : "tool-input.txt",
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
    ...(isPlainObject(baseMeta) ? baseMeta : {}),
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
  };
}

async function buildTransferResponse({ transferEnvelopes }) {
  if (!Array.isArray(transferEnvelopes)) {
    throw new TypeError("tool transfer response requires a transferEnvelopes array");
  }
  return { transferEnvelopes };
}

export async function transferToolOutput({
  runtime = {},
  text: inputText = "",
  name = "tool-result.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_tool_output",
  source = "tool",
  reason = "semantic_transfer_tool_output",
  meta = {},
  forceAttachment = false,
  inlineMaxChars = null,
  previewChars = LENGTH_THRESHOLDS.semanticTransfer.previewChars,
  forcePreview = false,
  identity = null,
} = {}) {
  const normalizedText = String(inputText);
  const intent = resolveTransferIntent({
    source,
    reason,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_OUTPUT,
  });
  const maxInline =
    inlineMaxChars == null
      ? resolveToolResultInlineTextLimit(runtime)
      : requireTransferCharLimit(inlineMaxChars);
  const materialized = await materializeTextForToolResult({
    runtime,
    text: normalizedText,
    name,
    mimeType,
    attachmentSource,
    generationSource,
    source: intent.source,
    reason: intent.reason,
    identity,
    meta,
    scenario: "tool",
    strategy: "tool_output",
    alwaysPersist: forceAttachment === true,
    inlineMaxChars: maxInline,
    previewChars,
    forcePreview,
  });

  return await buildTransferResponse({
    transferEnvelopes: materialized.transferEnvelopes,
  });
}

export async function transferToolInput({
  runtime = {},
  call = null,
  text: inputText = "",
  name = "tool-input.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  attachmentSource = "model",
  generationSource = "semantic_transfer_tool_input",
  source = "tool",
  reason = "semantic_transfer_tool_input",
  meta = {},
  forceAttachment = false,
  inlineMaxChars = null,
  identity = null,
} = {}) {
  const hasExplicitText = inputText !== "";
  const callOverflow =
    !hasExplicitText && call ? resolveToolInputOverflowFromCall(call, runtime) : null;
  if (!hasExplicitText && call && !callOverflow) {
    return {
      transferEnvelopes: [],
    };
  }
  const normalizedText = callOverflow ? callOverflow.text : String(inputText);
  const resolvedName = callOverflow?.name || name;
  const resolvedMimeType = callOverflow?.mimeType || mimeType;
  const resolvedSource = callOverflow?.source || source;
  const resolvedReason = callOverflow?.reason || reason;
  const resolvedMeta = {
    ...(isPlainObject(meta) ? meta : {}),
    ...(callOverflow?.meta || {}),
  };
  const intent = resolveTransferIntent({
    source: resolvedSource,
    reason: resolvedReason,
    fallbackSource: TRANSFER_SOURCE.TOOL,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
  });
  const resolvedInlineLimit =
    inlineMaxChars == null
      ? (callOverflow?.maxChars ?? resolveToolResultInlineTextLimit(runtime))
      : inlineMaxChars;
  const maxInline = requireTransferCharLimit(resolvedInlineLimit);
  const decision = decideTransfer({
    content: normalizedText,
    forceAttachment: forceAttachment === true || callOverflow?.forceAttachment === true,
    policy: { maxDirectChars: maxInline },
  });
  const inputExceeded = callOverflow?.exceeded === true || decision.reason === "threshold_exceeded";

  if (decision.mode === TRANSFER_MODE.DIRECT) {
    const envelope = directTransfer({
      transferId: identity.transferId,
      presentationMessageId: identity.presentationMessageId,
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
    content: normalizedText,
    name: firstText(resolvedName, "tool-input.txt"),
    mimeType: firstText(resolvedMimeType, DEFAULT_TRANSFER_MIME_TYPE),
    attachmentSource,
    generationSource,
    source: intent.source,
    reason: intent.reason,
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

  return await buildTransferResponse({
    transferEnvelopes: persisted.transferEnvelopes,
  });
}
