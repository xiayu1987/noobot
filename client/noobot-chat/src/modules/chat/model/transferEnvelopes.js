/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";

function getMessageTransferEnvelopes(messageItem = {}) {
  return mergeTransferEnvelopes(messageItem.transferEnvelopes);
}

function getTransferAttachments(envelopes = []) {
  return mergeTransferEnvelopes(envelopes).flatMap((envelope) => {
    if (envelope.payload.mode !== "attachment") return [];
    return envelope.payload.attachments.map((reference) => ({
      ...reference,
      ...reference.identity,
      attachmentId: reference.identity.attachmentId,
      sessionId: reference.identity.sessionId,
      attachmentSource: reference.identity.attachmentSource,
      name: reference.name,
      mimeType: reference.mimeType,
      size: reference.size,
      preview: reference.preview,
      transferId: envelope.transferId,
      presentationMessageId: envelope.presentationMessageId,
      transferRole: reference.role,
    }));
  });
}

function getMessageTransferAttachments(messageItem = {}) {
  return getTransferAttachments(getMessageTransferEnvelopes(messageItem));
}

export { getMessageTransferAttachments, getMessageTransferEnvelopes };
