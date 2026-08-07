/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertCanonicalAttachments,
  canonicalAttachmentIdentityKey,
  findMatchingAttachmentMeta,
  mergeAttachmentMetaPreferRich,
} from "../../../artifacts/index.js";

export { assertCanonicalAttachments };

export function dedupeAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return source.filter((item = {}) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    let key;
    try {
      key = canonicalAttachmentIdentityKey({
        attachmentId: item.attachmentId,
        sessionId: item.sessionId,
        attachmentSource: item.attachmentSource,
      });
    } catch {
      return false;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeIncomingAttachmentsForSessionMessage(existingAttachments = [], incomingAttachments = []) {
  if (!Array.isArray(incomingAttachments)) return undefined;
  if (incomingAttachments.length === 0) return [];
  const merged = incomingAttachments.map((incoming) => {
    const existing = findMatchingAttachmentMeta(incoming, existingAttachments);
    return existing ? mergeAttachmentMetaPreferRich(existing, incoming) : incoming;
  });
  const seen = new Set();
  return merged.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    let key;
    try {
      key = canonicalAttachmentIdentityKey({
        attachmentId: item.attachmentId,
        sessionId: item.sessionId,
        attachmentSource: item.attachmentSource,
      });
    } catch {
      key = `raw:${JSON.stringify(item)}`;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
