/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";
import { decodeToolResultText } from "@noobot/event-protocol/tool-result";
import { toToolJsonResult } from "../../tools/core/tool-json-result.js";
import {
  DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { sourceReferenceTransfer, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { tTool } from "../../tools/core/tool-i18n.js";

function transferIdentityRequired(identity) {
  if (!isPlainObject(identity)) throw new Error("semantic_transfer_overflow_identity_required");
  for (const key of ["transferId", "presentationMessageId", "sessionId", "turnScopeId", "runId"]) {
    if (typeof identity[key] !== "string" || !identity[key].trim()) {
      throw new Error(`semantic_transfer_overflow_${key}_required`);
    }
  }
  if (
    !isPlainObject(identity.producer) ||
    !text(identity.producer.type) ||
    !text(identity.producer.id)
  ) {
    throw new Error("semantic_transfer_overflow_producer_required");
  }
  return identity;
}

function requiredToolName(call) {
  const toolName = text(call?.name);
  if (!toolName) throw new Error("tool_result_overflow_tool_name_required");
  return toolName;
}

function encodeOverflowResult({ toolName, parsed, message, transferEnvelopes }) {
  const failure = parsed.ok ? {} : { code: parsed.code, error: parsed.error };
  return toToolJsonResult(toolName, {
    ok: parsed.ok,
    ...failure,
    message,
    overflowed: true,
    transferEnvelopes,
  });
}

function requiredLineNumber(parsed, field) {
  if (!Number.isInteger(parsed[field]) || parsed[field] < 0) {
    throw new Error(`read_file_source_reference_${field}_required`);
  }
  return parsed[field];
}

function readFileSourceAddress(pathRef) {
  if (!isPlainObject(pathRef)) throw new Error("read_file_source_reference_path_required");
  if (pathRef.view === "attachment") return pathRef.identity;
  if (pathRef.view === "workspace" || pathRef.view === "host") return pathRef.path;
  throw new Error(`read_file_source_reference_view_unsupported:${pathRef.view}`);
}

function buildReadFileSourceReference({ parsed, identity }) {
  const name = text(parsed.fileName);
  if (!name) throw new Error("read_file_source_reference_file_name_required");
  const reference = {
    address: readFileSourceAddress(parsed.path),
    name,
    mimeType: "text/plain",
    startLine: requiredLineNumber(parsed, "startLine"),
    endLine: requiredLineNumber(parsed, "endLine"),
    totalLines: requiredLineNumber(parsed, "totalLines"),
  };
  return sourceReferenceTransfer({
    transferId: identity.transferId,
    presentationMessageId: identity.presentationMessageId,
    identity,
    direction: "output",
    reference,
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.READ_FILE_SOURCE_REFERENCE,
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: { attributes: { toolName: "read_file", sourceReference: true } },
  });
}

export async function normalizeToolResultOverflow({
  call,
  toolResultText,
  runtime = {},
  identity = null,
} = {}) {
  const parsed = decodeToolResultText(toolResultText);
  const rawText = toolResultText;
  const maxChars = resolveToolResultInlineTextLimit(runtime, DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS);
  if (rawText.length <= maxChars) {
    return {
      toolResultText: rawText,
      overflowed: false,
      rawLength: rawText.length,
      measuredLength: rawText.length,
      transferEnvelopes: [],
    };
  }

  const ids = transferIdentityRequired(identity);
  const toolName = requiredToolName(call);
  if (toolName === "read_file") {
    const referenceEnvelope = buildReadFileSourceReference({ parsed, identity: ids });
    const normalized = encodeOverflowResult({
      toolName,
      parsed,
      message: tTool(runtime, "tools.result.readFileSourceReferenceOverflow"),
      transferEnvelopes: [referenceEnvelope],
    });
    return {
      toolResultText: normalized,
      overflowed: true,
      rawLength: rawText.length,
      measuredLength: rawText.length,
      transferEnvelopes: [referenceEnvelope],
    };
  }
  const persisted = await materializeTextForToolResult({
    runtime,
    text: rawText,
    name: `${toolName}.result.txt`,
    mimeType: "text/plain",
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: TRANSFER_REASON.TOOL_RESULT_OVERFLOW,
    source: "tool",
    reason: TRANSFER_REASON.TOOL_RESULT_OVERFLOW,
    alwaysPersist: true,
    forcePreview: true,
    identity: ids,
    meta: {
      overflowContentKind: "tool_result",
      toolName,
      toolCallId: text(call.id),
    },
  });
  const { transferEnvelopes } = persisted;
  if (!transferEnvelopes.length) {
    throw new Error("semantic_transfer_overflow_envelope_required");
  }

  const normalized = encodeOverflowResult({
    toolName,
    parsed,
    message: tTool(runtime, "tools.result.toolResultOverflow", { measuredLength: rawText.length }),
    transferEnvelopes,
  });
  return {
    toolResultText: normalized,
    overflowed: true,
    rawLength: rawText.length,
    measuredLength: rawText.length,
    transferEnvelopes,
  };
}
