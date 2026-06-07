/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE } from "./constants.js";
import { directOutput, fileOutput } from "./envelope.js";
import { persistTransferFile } from "./attachment-adapter.js";
import { normalizeTransferPolicy } from "./policy.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "./result.js";

export async function materializeOutputResult({
  runtime = {},
  agentContext = null,
  content = "",
  prefer = "auto",
  maxDirectChars = 8000,
  policy = null,
  name = "output.txt",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  source = "",
  reason = "",
  meta = {},
  attachmentSource = "model",
  generationSource = "",
  storage = null,
  producer = null,
} = {}) {
  const text = String(content || "");
  const transferPolicy = normalizeTransferPolicy({ policy, prefer, maxDirectChars });
  const outputMeta = {
    ...meta,
    source,
    reason,
    name,
    mimeType,
    size: text.length,
  };

  if (transferPolicy.prefer === "direct" || (transferPolicy.prefer === "auto" && text.length <= transferPolicy.maxDirectChars)) {
    const envelope = directOutput(text, outputMeta);
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.DIRECT, envelope });
  }

  if (transferPolicy.allowAttachmentPersist === false) {
    const envelope = directOutput(text, {
      ...outputMeta,
      materializeFallback: "direct",
      materializeFallbackReason: "attachment_persist_disabled",
    });
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FALLBACK_DIRECT, envelope });
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: text,
    name,
    mimeType,
    source,
    reason,
    attachmentSource,
    generationSource: generationSource || reason || source || "semantic_transfer_output",
    storage,
    producer,
    meta: outputMeta,
  });

  if (persisted?.result?.envelope) return persisted.result;
  if (persisted?.envelope) {
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: persisted.envelope });
  }
  if (persisted?.filePath) {
    const envelope = fileOutput(persisted.filePath, persisted.attachmentMeta, outputMeta);
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope });
  }

  // Preserve caller-visible behavior when persistence is unavailable: do not drop content unless explicitly disabled later.
  if (transferPolicy.allowFallbackDirect !== false) {
    const envelope = directOutput(text, {
      ...outputMeta,
      materializeFallback: "direct",
    });
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FALLBACK_DIRECT, envelope });
  }

  return createTransferResult({
    ok: false,
    status: TRANSFER_RESULT_STATUS.FAILED,
    error: { code: "TRANSFER_PERSIST_FAILED", message: "failed to persist transfer output" },
  });
}

export async function materializeOutput(options = {}) {
  const result = await materializeOutputResult(options);
  return result?.envelope || directOutput(String(options?.content || ""), { materializeFallback: "direct" });
}
