/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const STATUS_PENDING = "pending";

function text(value) {
  return String(value || "").trim();
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function deriveUserMetaBackwriteId(userMetaMessageUid = "", attachmentRef = "") {
  const metaId = text(userMetaMessageUid);
  const ref = text(attachmentRef);
  if (!metaId || !ref) return "";
  return `${metaId}::backwrite::${ref}`;
}

export function createUserMetaBackwrite({
  userMetaMessageUid = "",
  attachmentRef = "",
  result = {},
  createdAt = new Date().toISOString(),
} = {}) {
  const normalizedMetaId = text(userMetaMessageUid);
  const normalizedAttachmentRef = text(attachmentRef);
  const id = deriveUserMetaBackwriteId(normalizedMetaId, normalizedAttachmentRef);
  if (!id) throw new TypeError("user_meta backwrite requires userMetaMessageUid and attachmentRef");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("user_meta backwrite result must be an object");
  }
  return {
    backwriteId: id,
    userMetaMessageUid: normalizedMetaId,
    attachmentRef: normalizedAttachmentRef,
    result: cloneJson(result) || {},
    status: STATUS_PENDING,
    createdAt: text(createdAt) || new Date().toISOString(),
  };
}

export function normalizeUserMetaBackwrites(records = []) {
  if (!Array.isArray(records)) throw new TypeError("userMetaBackwrites must be an array");
  const seen = new Set();
  return records.map((record) => {
    const normalized = createUserMetaBackwrite(record || {});
    if (seen.has(normalized.backwriteId)) {
      throw new Error(`duplicate user_meta backwrite: ${normalized.backwriteId}`);
    }
    seen.add(normalized.backwriteId);
    return normalized;
  });
}

export const USER_META_BACKWRITE_STATUS = Object.freeze({ PENDING: STATUS_PENDING });
