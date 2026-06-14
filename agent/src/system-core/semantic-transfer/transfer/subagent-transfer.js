/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE, TRANSFER_REASON, TRANSFER_SOURCE } from "../core/constants.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "../core/result.js";
import { createTransferEnvelope } from "../envelope/envelope.js";
import {
  extractTransferEnvelopeFromPersisted,
  normalizeTransferEnvelopesWithPolicy,
} from "../envelope/envelope-utils.js";
import { resolveTransferIntent } from "../core/intent.js";
import { emitSemanticTransferValidation } from "../core/telemetry.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import { compactTransferPayloadForModel, firstNormalizedString } from "../core/compact.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeNextSteps(nextSteps = []) {
  return (Array.isArray(nextSteps) ? nextSteps : [])
    .map((item = {}) => ({
      nodeId: firstNormalizedString(item?.nodeId, item?.id, item),
      nodeName: firstNormalizedString(item?.nodeName, item?.name),
    }))
    .filter((item) => item.nodeId);
}

function normalizeSubAgentMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [messages];
  return list
    .map((item = {}, index) => {
      if (typeof item === "string") {
        return {
          id: `subagent-${index + 1}`,
          nodeId: "",
          nodeName: "",
          content: item,
        };
      }
      return {
        id: firstNormalizedString(item?.id, item?.stepId, item?.nodeId, `subagent-${index + 1}`),
        nodeId: firstNormalizedString(item?.nodeId),
        nodeName: firstNormalizedString(item?.nodeName, item?.name),
        content: String(item?.content || item?.output || item?.text || ""),
        meta: isPlainObject(item?.meta) ? item.meta : {},
      };
    })
    .filter((item) => normalizeString(item.content));
}

export async function transferBotPluginSubagentResult({
  runtime = {},
  agentContext = null,
  messages = [],
  nextSteps = [],
  forceAttachment = true,
  attachmentSource = "model",
  generationSource = "bot_plugin_subagent_result",
  source = "plugin",
  reason = "bot_plugin_subagent_result",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
} = {}) {
  const normalizedMessages = normalizeSubAgentMessages(messages);
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.PLUGIN,
    fallbackReason: TRANSFER_REASON.BOT_PLUGIN_SUBAGENT_RESULT,
    defaultGenerationSource: TRANSFER_REASON.BOT_PLUGIN_SUBAGENT_RESULT,
    allowCustom: true,
  });
  // Note: downstream message injection belongs to bot plugin orchestration.
  // Keep `nextSteps` normalization for lightweight validation only.
  normalizeNextSteps(nextSteps);
  const persistedItems = [];

  for (const [index, item] of normalizedMessages.entries()) {
    const text = String(item?.content || "");
    if (!text) continue;
    if (forceAttachment !== true) {
      const envelope = createTransferEnvelope({
        direction: "output",
        transport: "direct",
        content: text,
        meta: {
          source: intent.source,
          reason: intent.reason,
          nodeId: item?.nodeId,
          nodeName: item?.nodeName,
        },
      });
      persistedItems.push({
        ...item,
        transferResult: createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.DIRECT, envelope }),
        transferEnvelopes: [envelope],
      });
      continue;
    }

    const name = [
      "bot-plugin-node",
      firstNormalizedString(item?.nodeName, item?.nodeId, item?.id, String(index + 1))
        .replace(/\s+/g, "-")
        .toLowerCase(),
      "result.md",
    ]
      .filter(Boolean)
      .join("-");
    const persisted = await persistTransferFile({
      runtime,
      agentContext,
      content: text,
      name,
      mimeType,
      attachmentSource,
      generationSource: intent.generationSource,
      source: intent.source,
      reason: intent.reason,
      meta: {
        ...(isPlainObject(item?.meta) ? item.meta : {}),
        nodeId: item?.nodeId,
        nodeName: item?.nodeName,
      },
    });
    const transferEnvelopesResult = normalizeTransferEnvelopesWithPolicy(
      Array.isArray(persisted?.transferEnvelopes) ? persisted.transferEnvelopes : [],
      { runtime, enforceProtocol: true, withStats: true },
    );
    const transferEnvelopes = transferEnvelopesResult?.envelopes || [];
    persistedItems.push({
      ...item,
      transferResult: transferEnvelopes[0]
        ? createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: transferEnvelopes[0] })
        : createTransferResult({ ok: false, status: TRANSFER_RESULT_STATUS.FAILED }),
      transferEnvelopes,
      compactTransferPayload: compactTransferPayloadForModel({ transferEnvelopes }),
    });
  }

  const transferEnvelopesResult = normalizeTransferEnvelopesWithPolicy(
    persistedItems
    .flatMap((item = {}) => (Array.isArray(item.transferEnvelopes) ? item.transferEnvelopes : []))
    .filter(isPlainObject),
    { runtime, enforceProtocol: true, withStats: true },
  );
  const transferEnvelopes = transferEnvelopesResult?.envelopes || [];
  await emitSemanticTransferValidation({
    runtime,
    scenario: "bot_plugin_subagent_result",
    stats: transferEnvelopesResult?.stats || {},
  });

  return {
    transferResult: transferEnvelopes[0]
      ? createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: transferEnvelopes[0] })
      : createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.SKIPPED }),
    transferEnvelopes,
    nodeTransferResults: persistedItems,
    compactTransferPayload: compactTransferPayloadForModel({ transferEnvelopes }),
  };
}
