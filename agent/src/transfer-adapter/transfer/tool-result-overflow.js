/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toToolJsonResult } from "../../tools/core/tool-json-result.js";
import {
  DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS,
  materializeTextForToolResult,
  resolveToolResultInlineTextLimit,
} from "./tool-result-text.js";
import { sourceReferenceTransfer } from "@noobot/semantic-transfer-protocol";

function plain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(text = "") {
  try {
    const value = JSON.parse(String(text || ""));
    return plain(value) ? value : null;
  } catch {
    return null;
  }
}

function transferIdentityRequired(identity) {
  if (!plain(identity)) throw new Error("semantic_transfer_overflow_identity_required");
  for (const key of ["transferId", "messageId", "sessionId", "turnScopeId", "runId"]) {
    if (typeof identity[key] !== "string" || !identity[key].trim()) {
      throw new Error(`semantic_transfer_overflow_${key}_required`);
    }
  }
  if (!plain(identity.producer) || !String(identity.producer.type || "").trim() || !String(identity.producer.id || "").trim()) {
    throw new Error("semantic_transfer_overflow_producer_required");
  }
  return identity;
}

function overflowArtifactName(call = {}) {
  const toolName = String(call?.name || "tool").trim() || "tool";
  return `${toolName}.result.txt`;
}

function overflowMessage({ measuredLength, maxChars }) {
  return `工具返回内容过长(${measuredLength}字符)，已保存为附件，请按返回的 transfer 信息分批读取。`;
}

function buildReadFileSourceReference({ parsed = {}, identity }) {
  const pathRef = parsed?.path && typeof parsed.path === "object" ? parsed.path : null;
  const view = String(pathRef?.view || "").trim();
  const address =
    view === "attachment" && plain(pathRef?.identity)
      ? pathRef.identity
      : ["workspace", "host"].includes(view)
        ? String(pathRef?.path || "").trim()
        : null;
  if (!address) return null;
  const reference = {
    address,
    name: String(parsed?.fileName || "").trim() || "read-file-source",
    mimeType: "text/plain",
    ...(Number.isFinite(Number(parsed?.totalLines)) ? { size: Number(parsed.totalLines) } : {}),
    ...(Number.isFinite(Number(parsed?.startLine)) ? { startLine: Number(parsed.startLine) } : {}),
    ...(Number.isFinite(Number(parsed?.endLine)) ? { endLine: Number(parsed.endLine) } : {}),
  };
  return sourceReferenceTransfer({
    transferId: identity.transferId,
    messageId: identity.messageId,
    identity,
    direction: "output",
    reference,
    intent: {
      source: "tool",
      reason: "read_file_source_reference",
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: { attributes: { toolName: "read_file", sourceReference: true } },
  });
}

/**
 * Tool result overflow is an Agent adapter, not a protocol implementation.
 * It has exactly one materialization path: AttachmentService -> V2 Envelope.
 * It must never create paths, V1 envelopes, or a direct fallback after overflow.
 */
export async function normalizeToolResultOverflow({
  call = {},
  toolResultText = "",
  runtime = {},
  agentContext = null,
  sessionId = "",
  identity = null,
} = {}) {
  const rawText = String(toolResultText || "");
  const maxChars = resolveToolResultInlineTextLimit(runtime, DEFAULT_TOOL_RESULT_INLINE_TEXT_CHARS);
  if (rawText.length <= maxChars) {
    return {
      toolResultText: rawText,
      overflowed: false,
      rawLength: rawText.length,
      measuredLength: rawText.length,
    };
  }

  const ids = transferIdentityRequired(identity);
  if (String(sessionId || "").trim() && String(sessionId).trim() !== ids.sessionId) {
    throw new Error("semantic_transfer_overflow_session_identity_conflict");
  }
  const parsed = parseJsonObject(rawText);
  if (String(call?.name || "").trim() === "read_file") {
    const referenceEnvelope = buildReadFileSourceReference({ parsed, identity: ids });
    if (!referenceEnvelope) throw new Error("read_file_source_reference_required");
    const normalized = toToolJsonResult(call?.name, {
      ...(typeof parsed?.ok === "boolean" ? { ok: parsed.ok } : { ok: true }),
      message: "read_file 结果过长，已保留源文件引用，请按源文件地址和行范围继续读取。",
      overflowed: true,
      overflow_reason: `tool result length ${rawText.length} exceeds limit ${maxChars}`,
      transferEnvelopes: [referenceEnvelope],
      summary: { original_length: rawText.length, max_length: maxChars },
    });
    return { toolResultText: normalized, overflowed: true, rawLength: rawText.length, measuredLength: rawText.length, transferEnvelopes: [referenceEnvelope] };
  }
  const persisted = await materializeTextForToolResult({
    runtime,
    agentContext,
    text: rawText,
    name: overflowArtifactName(call),
    mimeType: "text/plain",
    attachmentSource: "model",
    generationSource: "tool_result_overflow",
    source: "tool",
    reason: "tool_result_overflow",
    alwaysPersist: true,
    forcePreview: true,
    identity: ids,
    meta: {
      overflowContentKind: "tool_result",
      toolName: String(call?.name || "").trim(),
      toolCallId: String(call?.id || call?.tool_call_id || call?.toolCallId || "").trim(),
    },
  });
  const transferEnvelopes = Array.isArray(persisted?.transferEnvelopes)
    ? persisted.transferEnvelopes
    : [];
  if (!transferEnvelopes.length) {
    throw new Error("semantic_transfer_overflow_envelope_required");
  }

  const message = String(parsed?.message || "").trim() || overflowMessage({
    measuredLength: rawText.length,
    maxChars,
  });
  const normalized = toToolJsonResult(call?.name, {
    ...(typeof parsed?.ok === "boolean" ? { ok: parsed.ok } : { ok: true }),
    ...(parsed?.status ? { status: parsed.status } : {}),
    message,
    overflowed: true,
    overflow_reason: `tool result length ${rawText.length} exceeds limit ${maxChars}`,
    transferEnvelopes,
    summary: {
      original_length: rawText.length,
      max_length: maxChars,
    },
  });
  return {
    toolResultText: normalized,
    overflowed: true,
    rawLength: rawText.length,
    measuredLength: rawText.length,
    transferEnvelopes,
  };
}
