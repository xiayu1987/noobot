/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getTransferAttachments } from "../../transfer-adapter/storage/consumer.js";
import {
  TRANSFER_REASON,
  normalizeTransferEnvelopes,
  selectUntransferredAttachments,
} from "@noobot/semantic-transfer-protocol";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import {
  compactTransferEnvelopes,
  dedupeSessionAttachmentRefs,
} from "../../session/transfer-attachment-refs.js";
import { isPlainObject, text } from "@noobot/shared/value";

const HIDDEN_INTERMEDIATE_GENERATION_SOURCES = new Set([TRANSFER_REASON.TOOL_RESULT_OVERFLOW]);

function shouldPromoteAttachmentToAssistant(attachmentItem = {}) {
  if (!isPlainObject(attachmentItem)) return false;
  const generationSource = text(attachmentItem?.generationSource);
  if (HIDDEN_INTERMEDIATE_GENERATION_SOURCES.has(generationSource)) return false;
  const attachmentSource = text(attachmentItem?.attachmentSource);
  return (
    attachmentItem?.generatedByModel === true ||
    attachmentSource === ATTACHMENT_SOURCE.MODEL ||
    Boolean(generationSource)
  );
}

function resolveTransferEnvelopesFromMessage(messageItem = {}) {
  return normalizeTransferEnvelopes(messageItem.transferEnvelopes);
}

function resolveAttachmentsFromMessage(messageItem) {
  const attachments = messageItem.attachments ?? [];
  if (!Array.isArray(attachments)) throw new TypeError("session attachments must be an array");
  return attachments;
}

function dedupeTransferEnvelopes(envelopes = []) {
  return normalizeTransferEnvelopes(compactTransferEnvelopes(envelopes));
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
  const attachments = dedupeSessionAttachmentRefs(
    sourceMessages.flatMap((messageItem = {}) =>
      selectUntransferredAttachments(
        resolveAttachmentsFromMessage(messageItem),
        resolveTransferEnvelopesFromMessage(messageItem),
      ).filter(shouldPromoteAttachmentToAssistant),
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
  const mergedAttachments = selectUntransferredAttachments(
    dedupeSessionAttachmentRefs([...resolveAttachmentsFromMessage(finalAssistant), ...attachments]),
    mergedTransferEnvelopes,
  );
  outputMessages[finalAssistantIndex] = {
    ...finalAssistant,
    ...(mergedTransferEnvelopes.length ? { transferEnvelopes: mergedTransferEnvelopes } : {}),
    attachments: mergedAttachments,
  };
  return outputMessages;
}
