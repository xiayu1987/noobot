/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text, isPlainObject } from "@noobot/shared/value";

const STATUS_PENDING = "pending";

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function backwriteKey(record) {
  return `${record.userMetaSourceMessageUid}\u0000${record.attachmentRef}`;
}

export function createUserMetaBackwrite({
  userMetaSourceMessageUid = "",
  attachmentRef = "",
  result = {},
  createdAt = new Date().toISOString(),
} = {}) {
  const sourceMessageUid = text(userMetaSourceMessageUid);
  const normalizedAttachmentRef = text(attachmentRef);
  if (!sourceMessageUid || !normalizedAttachmentRef) {
    throw new TypeError("user_meta backwrite requires userMetaSourceMessageUid and attachmentRef");
  }
  if (!isPlainObject(result)) {
    throw new TypeError("user_meta backwrite result must be an object");
  }
  return {
    userMetaSourceMessageUid: sourceMessageUid,
    attachmentRef: normalizedAttachmentRef,
    result: cloneJson(result) || {},
    status: STATUS_PENDING,
    createdAt: text(createdAt) || new Date().toISOString(),
  };
}

export function isSameUserMetaBackwrite(left = {}, right = {}) {
  return backwriteKey(left) === backwriteKey(right);
}

export function normalizeUserMetaBackwrites(records = []) {
  if (!Array.isArray(records)) throw new TypeError("userMetaBackwrites must be an array");
  const seen = new Set();
  return records.map((record) => {
    const normalized = createUserMetaBackwrite(record || {});
    const key = backwriteKey(normalized);
    if (seen.has(key)) {
      throw new Error(
        `duplicate user_meta backwrite: ${normalized.userMetaSourceMessageUid} ${normalized.attachmentRef}`,
      );
    }
    seen.add(key);
    return normalized;
  });
}

export function mergeUserMetaParsedResults(current = [], result = {}) {
  if (!isPlainObject(result)) {
    throw new TypeError("user_meta parsed result must be an object");
  }
  const resultRef = text(result.sourceAttachmentRef);
  if (!resultRef) throw new TypeError("user_meta parsed result requires sourceAttachmentRef");
  const existing = Array.isArray(current) ? current : [];
  return [
    ...existing.filter((item) => text(item?.sourceAttachmentRef) !== resultRef),
    cloneJson(result),
  ];
}
