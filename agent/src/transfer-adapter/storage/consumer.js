/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTransferEnvelope,
  attachmentIdentityKey,
  transferIdentityKey,
} from "@noobot/semantic-transfer-protocol";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function collect(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && Array.isArray(value.transferEnvelopes)) return value.transferEnvelopes;
  return [value];
}

function validated(value) {
  const seen = new Set();
  const result = [];
  for (const item of collect(value)) {
    const envelope = assertTransferEnvelope(item);
    const key = transferIdentityKey(envelope);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(envelope);
  }
  return result;
}

export function getTransferEnvelopes(value = null) {
  return validated(value);
}

export function getTransferAttachments(value = null) {
  const seen = new Set();
  const attachments = [];
  for (const envelope of validated(value)) {
    if (envelope.payload.mode !== "attachment") continue;
    for (const attachment of envelope.payload.attachments) {
      const key = attachmentIdentityKey(attachment.identity);
      if (seen.has(key)) continue;
      seen.add(key);
      attachments.push(attachment);
    }
  }
  return attachments;
}

export function getPrimaryTransferAttachment(value = null) {
  return getTransferAttachments(value)[0] || null;
}

export function getTransferAttachmentIdentities(value = null) {
  return getTransferAttachments(value).map(({ identity }) => identity);
}
