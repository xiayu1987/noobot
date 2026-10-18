/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  directTransfer,
  resolveTransferIntent,
  TRANSFER_REASON,
  TRANSFER_SOURCE,
  validateTransferEnvelope,
} from "@noobot/semantic-transfer-protocol";
import { emitSemanticTransferValidation } from "../core/validation-events.js";
import { persistTransferFile } from "../storage/attachment-adapter.js";

function normalizeSubAgentMessages(messages = []) {
  return messages
    .map((item = {}) => ({
      id: text(item.id),
      nodeId: text(item.nodeId),
      nodeName: text(item.nodeName),
      content: String(item.content ?? ""),
      meta: isPlainObject(item.meta) ? item.meta : {},
    }))
    .filter((item) => text(item.content));
}

export async function transferBotPluginSubagentResult({
  runtime = {},
  messages = [],
  forceAttachment = true,
  attachmentSource = "model",
  generationSource = "workflow_subagent",
  source = "plugin",
  reason = "workflow_subagent",
  mimeType = DEFAULT_TRANSFER_MIME_TYPE,
  identity = null,
} = {}) {
  if (!isObjectLike(identity)) {
    throw new Error("semantic_transfer_subagent_identity_required");
  }
  const normalizedMessages = normalizeSubAgentMessages(messages);
  const intent = resolveTransferIntent({
    source,
    reason,
    fallbackSource: TRANSFER_SOURCE.PLUGIN,
    fallbackReason: TRANSFER_REASON.WORKFLOW_SUBAGENT,
  });
  const persistedItems = [];

  for (const item of normalizedMessages) {
    const itemContent = item.content;
    if (!item.id) throw new Error("semantic_transfer_subagent_message_identity_required");
    if (!item.nodeName) throw new Error("semantic_transfer_subagent_message_node_name_required");
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
        content: itemContent,
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

    const name = ["bot-plugin-node", item.nodeName.replace(/\s+/g, "-").toLowerCase(), "result.md"]
      .filter(Boolean)
      .join("-");
    const persisted = await persistTransferFile({
      runtime,
      content: itemContent,
      name,
      mimeType,
      attachmentSource,
      identity: itemIdentity,
      generationSource,
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
    transferEnvelopes.forEach((envelope) => validateTransferEnvelope(envelope, { strict: true }));
    persistedItems.push({ ...item, transferEnvelopes });
  }

  const transferEnvelopes = persistedItems
    .flatMap((item = {}) => (Array.isArray(item.transferEnvelopes) ? item.transferEnvelopes : []))
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
