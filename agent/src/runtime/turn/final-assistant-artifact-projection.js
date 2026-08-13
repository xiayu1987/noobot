/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getTransferAttachments } from "../../transfer-adapter/storage/consumer.js";
import { transferIdentityKey } from "@noobot/semantic-transfer-protocol";
import {
  compactSessionAttachmentRef,
  compactTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../../session/transfer-attachment-refs.js";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set(["tool_result_overflow"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shouldPromoteAttachmentToAssistant(attachmentItem = {}) {
  if (!isPlainObject(attachmentItem)) return false;
  const generationSource = String(attachmentItem?.generationSource || "").trim();
  if (HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource)) return false;
  const attachmentSource = String(attachmentItem?.attachmentSource || "").trim();
  return (
    attachmentItem?.generatedByModel === true ||
    attachmentSource === "model" ||
    attachmentSource === "model_generated" ||
    Boolean(generationSource)
  );
}

function resolveTransferEnvelopesFromMessage(messageItem = {}) {
  return Array.isArray(messageItem?.transferEnvelopes)
    ? messageItem.transferEnvelopes.filter(isPlainObject)
    : [];
}

function resolveAttachmentsFromMessage(messageItem = {}) {
  return Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
}

function dedupeTransferEnvelopes(envelopes = []) {
  const seen = new Set();
  return compactTransferEnvelopes(envelopes).filter((envelope) => {
    if (!isPlainObject(envelope)) return false;
    const key = transferIdentityKey(envelope);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeAttachments(attachments = []) {
  return dedupeSessionAttachmentRefs(
    (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => compactSessionAttachmentRef(attachment))
      .filter(Boolean),
  );
}

function shouldPromoteTransferEnvelope(envelope = {}) {
  if (!isPlainObject(envelope)) return false;
  const attachments = getTransferAttachments(envelope);
  if (!attachments.length) return true;
  return attachments.some((item = {}) => {
    const attributes = isPlainObject(envelope?.meta?.attributes) ? envelope.meta.attributes : {};
    return shouldPromoteAttachmentToAssistant({
      ...attributes,
      ...item,
      attachmentSource: item?.identity?.attachmentSource,
    });
  });
}

export function projectGeneratedArtifactsToFinalAssistant(messages = []) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  if (!sourceMessages.length) return sourceMessages;
  const transferEnvelopes = dedupeTransferEnvelopes(
    sourceMessages.flatMap((messageItem = {}) =>
      resolveTransferEnvelopesFromMessage(messageItem).filter(shouldPromoteTransferEnvelope),
    ),
  );
  const attachments = dedupeAttachments(
    sourceMessages.flatMap((messageItem = {}) =>
      resolveTransferEnvelopesFromMessage(messageItem).length
        ? []
        : resolveAttachmentsFromMessage(messageItem).filter(shouldPromoteAttachmentToAssistant),
    ),
  );
  if (!transferEnvelopes.length && !attachments.length) return sourceMessages;

  let finalAssistantIndex = -1;
  for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
    const item = sourceMessages[index] || {};
    if (
      String(item?.role || "") === "assistant" &&
      String(item?.type || "message") !== "tool_call"
    ) {
      finalAssistantIndex = index;
      break;
    }
  }
  if (finalAssistantIndex < 0) return sourceMessages;

  const outputMessages = [...sourceMessages];
  const finalAssistant = outputMessages[finalAssistantIndex] || {};
  const mergedTransferEnvelopes = dedupeTransferEnvelopes([
    ...resolveTransferEnvelopesFromMessage(finalAssistant),
    ...transferEnvelopes,
  ]);
  const mergedAttachments = dedupeAttachments([
    ...resolveAttachmentsFromMessage(finalAssistant),
    ...attachments,
  ]);
  outputMessages[finalAssistantIndex] = {
    ...finalAssistant,
    ...(mergedTransferEnvelopes.length ? { transferEnvelopes: mergedTransferEnvelopes } : {}),
    ...(mergedAttachments.length ? { attachments: mergedAttachments } : {}),
  };
  return outputMessages;
}
