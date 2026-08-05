/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertCanonicalAttachments,
  findMatchingAttachmentMeta,
  mergeAttachmentMetaPreferRich,
} from "../../../artifacts/index.js";

export { assertCanonicalAttachments };

export function dedupeAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return source.filter((item = {}) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const key = String(item?.attachmentId || "").trim() ||
      `${String(item?.path || "").trim()}|${String(item?.relativePath || "").trim()}|${String(item?.name || "").trim()}`;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeIncomingAttachmentsForSessionMessage(existingAttachments = [], incomingAttachments = []) {
  if (!Array.isArray(incomingAttachments)) return undefined;
  if (incomingAttachments.length === 0) return [];
  return dedupeAttachments(incomingAttachments.map((incoming) => {
    const existing = findMatchingAttachmentMeta(incoming, existingAttachments);
    return existing ? mergeAttachmentMetaPreferRich(existing, incoming) : incoming;
  }));
}
