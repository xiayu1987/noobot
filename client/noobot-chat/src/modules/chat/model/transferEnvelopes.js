/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getTransferAttachmentReferences as getCanonicalTransferAttachmentReferences,
  mergeTransferEnvelopes,
  normalizeTransferEnvelopes as normalizeCanonicalTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";

function normalizeTransferEnvelopes(value = null) {
  return normalizeCanonicalTransferEnvelopes(value);
}

function getMessageTransferEnvelopes(messageItem = {}) {
  const values = [
    messageItem?.transferEnvelopes,
    messageItem?.payload?.transferEnvelopes,
    messageItem?.pluginMeta?.payload?.transferEnvelopes,
    messageItem?.pluginMeta?.payload?.nodeResultTransferEnvelopes,
  ];
  for (const run of messageItem?.pluginMeta?.payload?.execution?.nodeAgentRuns || []) {
    values.push(run?.transferEnvelopes, run?.nodeResultTransferEnvelopes);
  }
  for (const session of messageItem?.pluginMeta?.payload?.nodeSessions || []) {
    values.push(session?.transferEnvelopes, session?.nodeResultTransferEnvelopes);
  }
  return mergeTransferEnvelopes(...values);
}

function getTransferAttachmentReferences(value = null) {
  return getCanonicalTransferAttachmentReferences(value);
}

function getTransferAttachments(value = null) {
  const envelopes = Array.isArray(value) ? normalizeTransferEnvelopes(value) : getMessageTransferEnvelopes(value);
  return envelopes.flatMap((envelope) => {
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
      messageId: envelope.messageId,
      transferRole: reference.role,
    }));
  });
}

function getMessageTransferAttachments(messageItem = {}) {
  return getTransferAttachments(getMessageTransferEnvelopes(messageItem));
}

export {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  getTransferAttachments,
  getTransferAttachmentReferences,
  mergeTransferEnvelopes,
  normalizeTransferEnvelopes,
};
