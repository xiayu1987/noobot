/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_REASON } from "../core/constants.js";
import { createDirectTransferEnvelope, persistTransferFile } from "./attachment-adapter.js";
import { resolveTransferIntent } from "../core/intent.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "../core/result.js";
import {
  decideTransfer,
  normalizeTransferEnvelopes,
  TRANSFER_MODE,
  TRANSFER_SOURCE,
} from "@noobot/semantic-transfer-protocol";

export async function materializeOutputResult({
  runtime = {},
  agentContext = null,
  content = "",
  maxDirectChars,
  policy = {},
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
  const decision = decideTransfer({
    content: text,
    policy,
    ...(maxDirectChars === undefined ? {} : { maxDirectChars }),
  });
  const outputMeta = {
    mimeType,
    originalLength: text.length,
    ...(Object.keys(meta || {}).length ? { attributes: meta } : {}),
  };

  if (decision.mode === TRANSFER_MODE.DIRECT) {
    const envelope = createDirectTransferEnvelope({
      identity,
      content: text,
      intent: {
        source: intent.source,
        reason: intent.reason,
        scenario: "tool",
        strategy: "tool_output",
      },
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
    intent: {
      source: intent.source,
      reason: intent.reason,
      scenario: "tool",
      strategy: "tool_output",
    },
    attachmentSource,
    generationSource: intent.generationSource,
    storage,
    producer,
    identity,
    meta: outputMeta,
  });

  const persistedTransferEnvelopes = normalizeTransferEnvelopes(
    persisted?.transferEnvelopes,
  );
  if (persistedTransferEnvelopes.length !== 1) {
    throw new Error("semantic_transfer_materializer_expected_single_envelope");
  }
  const [persistedEnvelope] = persistedTransferEnvelopes;
  if (persistedEnvelope) {
    return createTransferResult({
      ok: true,
      status: TRANSFER_RESULT_STATUS.FILE,
      envelope: persistedEnvelope,
    });
  }
}

export async function materializeOutput(options = {}) {
  const result = await materializeOutputResult(options);
  if (!result?.ok || !result.envelope) {
    throw new Error(result?.error?.message || "semantic_transfer_materialization_failed");
  }
  return result.envelope;
}
