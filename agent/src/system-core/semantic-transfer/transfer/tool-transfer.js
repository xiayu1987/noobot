/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../../utils/path-resolver.js";
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
import { emitSemanticTransferValidation } from "../core/validation-events.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import { firstNormalizedString } from "../core/compact.js";
import {
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const TOOL_INPUT_OVERFLOW_MAX_CHARS =
  LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars;

const TOOL_INPUT_OVERFLOW_LIMITS = Object.freeze({
  WRITE_FILE_CONTENT_CHARS: TOOL_INPUT_OVERFLOW_MAX_CHARS,
  EXECUTE_SCRIPT_COMMAND_CHARS: TOOL_INPUT_OVERFLOW_MAX_CHARS,
  SEARCH_TEXT_CHARS: TOOL_INPUT_OVERFLOW_MAX_CHARS,
  PATCH_FILE_PATCH_CHARS: TOOL_INPUT_OVERFLOW_MAX_CHARS,
  TASK_SUMMARY_CONTENT_CHARS: TOOL_INPUT_OVERFLOW_MAX_CHARS,
});

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

function basenameOrFallback(value = "", fallback = "tool-input.txt") {
  const normalized = normalizeString(value);
  const base = normalized ? path.basename(normalized) : "";
  return base || fallback;
}

const TOOL_INPUT_OVERFLOW_POLICIES = Object.freeze([
  Object.freeze({
    toolName: "write_file",
    field: "content",
    maxChars: TOOL_INPUT_OVERFLOW_LIMITS.WRITE_FILE_CONTENT_CHARS,
    message: "文件内容过长，请分批写入",
    reason: TRANSFER_REASON.WRITE_FILE_INPUT_TOO_LONG,
    name: ({ args = {} } = {}) =>
      `${basenameOrFallback(args?.filePath, "write-file-content")}.tool-input.txt`,
    meta: ({ args = {} } = {}) => ({
      targetPath: normalizeString(args?.filePath),
    }),
  }),
  Object.freeze({
    toolName: "execute_script",
    field: "command",
    maxChars: TOOL_INPUT_OVERFLOW_LIMITS.EXECUTE_SCRIPT_COMMAND_CHARS,
    message: "脚本内容过长，请分批执行或拆分脚本/文本后重试",
    reason: TRANSFER_REASON.EXECUTE_SCRIPT_INPUT_TOO_LONG,
    name: () => "execute-script-command.tool-input.sh",
  }),
  Object.freeze({
    toolName: "search",
    field: "text",
    maxChars: TOOL_INPUT_OVERFLOW_LIMITS.SEARCH_TEXT_CHARS,
    message: "text is too long; search in smaller chunks",
    reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
    name: () => "search-text.tool-input.txt",
    enabled: ({ args = {} } = {}) => normalizeString(args?.source || "files") === "text",
  }),
  Object.freeze({
    toolName: "patch_file",
    field: "patch",
    maxChars: TOOL_INPUT_OVERFLOW_LIMITS.PATCH_FILE_PATCH_CHARS,
    message: "补丁内容过长，请分批应用或拆分 patch 后重试",
    reason: TRANSFER_REASON.PATCH_FILE_INPUT_TOO_LONG,
    name: () => "patch-file-patch.tool-input.diff",
  }),
  Object.freeze({
    toolName: "task_summary",
    field: "summaryContent",
    maxChars: TOOL_INPUT_OVERFLOW_LIMITS.TASK_SUMMARY_CONTENT_CHARS,
    forceAttachment: true,
    reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
    name: () => "task-summary-content.tool-input.md",
  }),
]);

function resolveToolInputOverflowFromCall(call = {}) {
  const toolName = normalizeString(call?.name);
  const args = isPlainObject(call?.args) ? call.args : {};
  const policy = TOOL_INPUT_OVERFLOW_POLICIES.find((item) => item.toolName === toolName);
  if (!policy) return null;
  if (typeof policy.enabled === "function" && policy.enabled({ call, args }) !== true) {
    return null;
  }
  const text = normalizeRawString(args?.[policy.field]);
  const maxChars = Number(policy.maxChars || 0);
  const exceeded = text.length > maxChars;
  const forceAttachment = policy.forceAttachment === true;
  if (!exceeded && !forceAttachment) return null;
  const policyMeta =
    typeof policy.meta === "function" && isPlainObject(policy.meta({ call, args }))
      ? policy.meta({ call, args })
      : {};
  return {
    toolName,
    field: policy.field,
    text,
    maxChars,
    exceeded,
    forceAttachment,
    message: policy.message,
    name: typeof policy.name === "function" ? policy.name({ call, args }) : "tool-input.txt",
    mimeType: DEFAULT_TRANSFER_MIME_TYPE,
    source: TRANSFER_SOURCE.TOOL,
    reason: policy.reason,
    meta: {
      toolName,
      field: policy.field,
      ...policyMeta,
    },
  };
}

function remapEnvelopeDirection(envelope = {}, direction = TRANSFER_DIRECTION.OUTPUT) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  if (normalizeString(envelope.direction) === direction) return envelope;
  return createTransferEnvelope({
    ...envelope,
    direction,
  });
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
    ...(baseMeta && typeof baseMeta === "object" && !Array.isArray(baseMeta) ? baseMeta : {}),
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

async function buildTransferResponse({
  transferEnvelopes = [],
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
  await emitSemanticTransferValidation({
    runtime,
    scenario,
    stats: validationStats,
  });
  return { transferEnvelopes: normalizedEnvelopes };
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
    textLength: normalizedText.length,
    exceeded: normalizedText.length > maxInline || forceAttachment === true,
  });
  const transferEnvelopes = persistedTransferEnvelopes[0] ? persistedTransferEnvelopes : [directEnvelope];

  return await buildTransferResponse({
    transferEnvelopes,
    runtime,
    scenario: "tool_output",
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
} = {}) {
  const hasExplicitText = text !== "" || content !== "";
  const callOverflow = !hasExplicitText && call ? resolveToolInputOverflowFromCall(call) : null;
  if (!hasExplicitText && call && !callOverflow) {
    return {
      transferEnvelopes: [],
    };
  }
  const normalizedText = callOverflow ? callOverflow.text : String(text || content || "");
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
  const resolvedInlineLimit = inlineMaxChars == null
    ? (callOverflow?.maxChars ?? resolveToolResultInlineTextLimit(runtime))
    : inlineMaxChars;
  const maxInline = toSafePositiveInt(resolvedInlineLimit, resolveToolResultInlineTextLimit(runtime), 0);
  const shouldPersist =
    forceAttachment === true || callOverflow?.forceAttachment === true || normalizedText.length > maxInline;
  const inputExceeded = callOverflow?.exceeded === true || normalizedText.length > maxInline;

  if (!shouldPersist) {
    const envelopeMeta = buildToolInputTransferMeta({
      baseMeta: resolvedMeta,
      normalizedText,
      resolvedMimeType,
      intent,
      callOverflow,
      exceeded: inputExceeded,
    });
    const envelope = directInput(normalizedText, {
      ...envelopeMeta,
      inlineContent: normalizedText,
    });
    return await buildTransferResponse({
      transferEnvelopes: [envelope],
      runtime,
      scenario: "tool_input",
    });
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: normalizedText,
    name: firstNormalizedString(resolvedName, "tool-input.txt"),
    mimeType: firstNormalizedString(resolvedMimeType, DEFAULT_TRANSFER_MIME_TYPE),
    attachmentSource,
    generationSource: intent.generationSource,
    source: intent.source,
    reason: intent.reason,
    storage,
    producer,
    meta: {
      ...buildToolInputTransferMeta({
        baseMeta: resolvedMeta,
        normalizedText,
        resolvedMimeType,
        intent,
        callOverflow,
        exceeded: inputExceeded,
      }),
    },
  });

  const outputEnvelope = extractTransferEnvelopeFromPersisted(persisted);
  const transferEnvelopes = normalizeTransferEnvelopes(
    outputEnvelope ? [remapEnvelopeDirection(outputEnvelope, TRANSFER_DIRECTION.INPUT)] : [],
  );

  return await buildTransferResponse({
    transferEnvelopes,
    runtime,
    scenario: "tool_input",
  });
}
