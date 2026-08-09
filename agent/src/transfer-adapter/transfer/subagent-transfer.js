/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
} from "../core/constants.js";
import {
  directTransfer,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import { resolveTransferIntent } from "../core/intent.js";
import { emitSemanticTransferValidation } from "../core/validation-events.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";
import { firstNormalizedString } from "../core/compact.js";

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
    .map((item = {}) => {
      if (typeof item === "string") {
        return {
          id: "",
          nodeId: "",
          nodeName: "",
          content: item,
        };
      }
      return {
        id: firstNormalizedString(item?.id, item?.stepId, item?.nodeId),
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
  generationSource = "workflow_subagent",
  source = "plugin",
  reason = "workflow_subagent",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  identity = null,
  userId = "",
} = {}) {
  if (!identity || typeof identity !== "object") {
    throw new Error("semantic_transfer_subagent_identity_required");
  }
  const normalizedMessages = normalizeSubAgentMessages(messages);
  const intent = resolveTransferIntent({
    source,
    reason,
    generationSource,
    fallbackSource: TRANSFER_SOURCE.PLUGIN,
    fallbackReason: TRANSFER_REASON.WORKFLOW_SUBAGENT,
    defaultGenerationSource: TRANSFER_REASON.WORKFLOW_SUBAGENT,
    allowCustom: true,
  });
  normalizeNextSteps(nextSteps);
  const persistedItems = [];

  for (const [index, item] of normalizedMessages.entries()) {
    const text = String(item?.content || "");
    if (!text) continue;
    if (!item.id)
      throw new Error("semantic_transfer_subagent_message_identity_required");
    const itemIdentity = {
      ...identity,
      transferId: `${identity.transferId}:subagent:${item.id}`,
      producer: { type: "subagent", id: item.id },
    };
    if (forceAttachment !== true) {
      const envelope = directTransfer({
        transferId: itemIdentity.transferId,
        messageId: itemIdentity.messageId,
        identity: itemIdentity,
        direction: "output",
        content: text,
        intent: {
          source: intent.source,
          reason: intent.reason,
          scenario: "workflow",
          strategy: "workflow_subagent",
          category: "sub_agent",
          businessPoint: "task_result",
        },
        meta: {
          attributes: { nodeId: item?.nodeId, nodeName: item?.nodeName },
        },
      });
      persistedItems.push({ ...item, transferEnvelopes: [envelope] });
      continue;
    }

    const name = [
      "bot-plugin-node",
      firstNormalizedString(
        item?.nodeName,
        item?.nodeId,
        item?.id,
        String(index + 1),
      )
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
      userId,
      identity: itemIdentity,
      generationSource: intent.generationSource,
      source: intent.source,
      reason: intent.reason,
      intent: {
        source: intent.source,
        reason: intent.reason,
        scenario: "workflow",
        strategy: "workflow_subagent",
        category: "sub_agent",
        businessPoint: "task_result",
      },
      meta: {
        attributes: {
          ...(isPlainObject(item?.meta) ? item.meta : {}),
          nodeId: item?.nodeId,
          nodeName: item?.nodeName,
        },
      },
    });
    const transferEnvelopes = Array.isArray(persisted?.transferEnvelopes)
      ? persisted.transferEnvelopes
      : [];
    transferEnvelopes.forEach((envelope) =>
      validateTransferEnvelope(envelope, { strict: true }),
    );
    persistedItems.push({ ...item, transferEnvelopes });
  }

  const transferEnvelopes = persistedItems
    .flatMap((item = {}) =>
      Array.isArray(item.transferEnvelopes) ? item.transferEnvelopes : [],
    )
    .filter(isPlainObject);
  await emitSemanticTransferValidation({
    runtime,
    scenario: "workflow",
    stats: {
      inputCount: transferEnvelopes.length,
      outputCount: transferEnvelopes.length,
      enforceProtocol: true,
    },
  });

  return { transferEnvelopes };
}
