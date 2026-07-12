/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findMatchingAttachmentMeta,
  mergeAttachmentMetaPreferRich,
} from "../../../attach/index.js";

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
  // Payload attachments may be raw transport refs ({ name, mimeType, size }).
  // Session user-message attachments are the display/edit-back carrier, so write
  // paths must merge rich-first instead of letting raw refs downgrade parsedResult
  // or preview/download addressing.  Only preserve rich fields for attachments
  // still present in the explicit incoming set; [] remains delete-all.
  return dedupeAttachments(incomingAttachments.map((incoming) => {
    const existing = findMatchingAttachmentMeta(incoming, existingAttachments);
    return existing ? mergeAttachmentMetaPreferRich(existing, incoming) : incoming;
  }));
}

export function assertCanonicalAttachments(attachments = [], sessionId = "") {
  for (const item of Array.isArray(attachments) ? attachments : []) {
    const attachmentId = String(item?.attachmentId || item?.id || "").trim();
    const ownerSessionId = String(item?.sessionId || "").trim();
    const parsed = item?.parsedResult && typeof item.parsedResult === "object" ? item.parsedResult : {};
    const address = String(item?.path || item?.relativePath || item?.sandboxPath || item?.url || parsed?.path || parsed?.relativePath || "").trim();
    if (!attachmentId || !ownerSessionId || ownerSessionId !== String(sessionId || "").trim() || !address) {
      const error = new Error("attachment must be canonical and belong to the current session");
      error.statusCode = 400;
      error.errorCode = "INVALID_CANONICAL_ATTACHMENT";
      throw error;
    }
  }
}
