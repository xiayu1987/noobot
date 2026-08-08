/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_REASON, TRANSFER_SOURCE } from "../core/constants.js";
import { createDirectTransferEnvelope } from "./attachment-adapter.js";
import { resolveTransferIntent } from "../core/intent.js";
import { persistTransferFile } from "./attachment-adapter.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "../core/result.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const SEMANTIC_TRANSFER_POLICY_DIRECT_CHARS =
  LENGTH_THRESHOLDS.semanticTransfer.directChars;

export async function materializeOutputResult({
  runtime = {},
  agentContext = null,
  content = "",
  prefer = "auto",
  maxDirectChars = SEMANTIC_TRANSFER_POLICY_DIRECT_CHARS,
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
  identity = null,
} = {}) {
  const text = String(content || "");
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.SERVICE,
    fallbackReason: TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
    defaultGenerationSource: TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT,
    allowCustom: true,
  });
  const transferPolicy = policy && typeof policy === "object" ? policy : {};
  const selectedPrefer = String(transferPolicy.prefer ?? prefer ?? "auto").trim().toLowerCase();
  const selectedMaxDirectChars = Number.isSafeInteger(transferPolicy.maxDirectChars)
    ? transferPolicy.maxDirectChars
    : maxDirectChars;
  const outputMeta = {
    mimeType,
    originalLength: text.length,
    ...(Object.keys(meta || {}).length ? { attributes: meta } : {}),
  };

  if (selectedPrefer === "direct" || (selectedPrefer === "auto" && text.length <= selectedMaxDirectChars)) {
    const envelope = createDirectTransferEnvelope({
      identity,
      content: text,
      intent: { source: intent.source, reason: intent.reason, scenario: "service", strategy: "semantic_transfer_output" },
      meta: outputMeta,
    });
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.DIRECT, envelope });
  }

  const persisted = await persistTransferFile({
    runtime,
    agentContext,
    content: text,
    name,
    mimeType,
    source: intent.source,
    reason: intent.reason,
    attachmentSource,
    generationSource: intent.generationSource,
    storage,
    producer,
    identity,
    meta: outputMeta,
  });

  const persistedEnvelope = Array.isArray(persisted?.transferEnvelopes)
    ? persisted.transferEnvelopes.find((item) => item && typeof item === "object" && !Array.isArray(item))
    : null;
  if (persistedEnvelope) {
    return createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: persistedEnvelope });
  }

  return createTransferResult({
    ok: false,
    status: TRANSFER_RESULT_STATUS.FAILED,
    error: { code: "TRANSFER_PERSIST_FAILED", message: "failed to persist transfer output" },
  });
}

export async function materializeOutput(options = {}) {
  const result = await materializeOutputResult(options);
  if (!result?.ok || !result.envelope) {
    throw new Error(result?.error?.message || "semantic_transfer_materialization_failed");
  }
  return result.envelope;
}
