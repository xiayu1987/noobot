/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_TRANSFER_MIME_TYPE } from "./constants.js";
import { createTransferResult, TRANSFER_RESULT_STATUS } from "./result.js";
import { createTransferEnvelope } from "./envelope.js";
import { persistTransferFile } from "./attachment-adapter.js";
import { compactTransferPayloadForModel } from "./compact.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeNextSteps(nextSteps = []) {
  return (Array.isArray(nextSteps) ? nextSteps : [])
    .map((item = {}) => ({
      nodeId: normalizeString(item?.nodeId || item?.id || item),
      nodeName: normalizeString(item?.nodeName || item?.name || ""),
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
        id: normalizeString(item?.id || item?.stepId || item?.nodeId || `subagent-${index + 1}`),
        nodeId: normalizeString(item?.nodeId || ""),
        nodeName: normalizeString(item?.nodeName || item?.name || ""),
        content: String(item?.content || item?.output || item?.text || ""),
        meta: isPlainObject(item?.meta) ? item.meta : {},
      };
    })
    .filter((item) => normalizeString(item.content));
}

export async function transferSubAgentMessages({
  runtime = {},
  agentContext = null,
  messages = [],
  nextSteps = [],
  forceAttachment = true,
  attachmentSource = "model",
  generationSource = "workflow_subagent_result",
  source = "plugin",
  reason = "workflow_subagent_result",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
} = {}) {
  const normalizedMessages = normalizeSubAgentMessages(messages);
  // Note: downstream message injection belongs to workflow orchestration.
  // Keep `nextSteps` normalization for lightweight validation/compat only.
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
          source,
          reason,
          nodeId: item?.nodeId,
          nodeName: item?.nodeName,
        },
      });
      persistedItems.push({
        ...item,
        transferResult: createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.DIRECT, envelope }),
        transferEnvelope: envelope,
        transferEnvelopes: [envelope],
      });
      continue;
    }

    const name = [
      "workflow-node",
      normalizeString(item?.nodeName || item?.nodeId || item?.id || String(index + 1)).replace(/\s+/g, "-").toLowerCase(),
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
      generationSource,
      source,
      reason,
      meta: {
        ...(isPlainObject(item?.meta) ? item.meta : {}),
        nodeId: item?.nodeId,
        nodeName: item?.nodeName,
      },
    });
    const transferEnvelope =
      persisted?.envelope && typeof persisted.envelope === "object" && !Array.isArray(persisted.envelope)
        ? persisted.envelope
        : persisted?.result?.envelope && typeof persisted.result.envelope === "object" && !Array.isArray(persisted.result.envelope)
          ? persisted.result.envelope
          : null;
    const transferEnvelopes = transferEnvelope ? [transferEnvelope] : [];
    persistedItems.push({
      ...item,
      transferResult: transferEnvelope
        ? createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: transferEnvelope })
        : createTransferResult({ ok: false, status: TRANSFER_RESULT_STATUS.FAILED }),
      transferEnvelope,
      transferEnvelopes,
      compactTransferPayload: compactTransferPayloadForModel({ transferEnvelope, transferEnvelopes }),
    });
  }

  const transferEnvelopes = persistedItems
    .flatMap((item = {}) => (Array.isArray(item.transferEnvelopes) ? item.transferEnvelopes : []))
    .filter(isPlainObject);
  const transferEnvelope = transferEnvelopes[0] || null;

  return {
    transferResult: transferEnvelope
      ? createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.FILE, envelope: transferEnvelope })
      : createTransferResult({ ok: true, status: TRANSFER_RESULT_STATUS.SKIPPED }),
    transferEnvelope,
    transferEnvelopes,
    nodeTransferResults: persistedItems,
    compactTransferPayload: compactTransferPayloadForModel({ transferEnvelope, transferEnvelopes }),
  };
}
