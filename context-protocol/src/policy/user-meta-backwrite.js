/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { isCanonicalMessageTimestamp } from "@noobot/session-protocol";
import { requireUserMetaParsedResultAttachmentRef } from "@noobot/session-protocol/session-changes";

const STATUS_PENDING = "pending";

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function backwriteKey(record) {
  return JSON.stringify([
    record.userMetaSourceMessageUid,
    requireUserMetaParsedResultAttachmentRef(record.result),
  ]);
}

export function createUserMetaBackwrite({
  userMetaSourceMessageUid,
  attachmentRef,
  result,
  createdAt = new Date().toISOString(),
}) {
  if (!isCanonicalText(userMetaSourceMessageUid) || !isCanonicalText(attachmentRef)) {
    throw new TypeError("user_meta backwrite requires userMetaSourceMessageUid and attachmentRef");
  }
  const sourceAttachmentRef = requireUserMetaParsedResultAttachmentRef(result);
  if (attachmentRef !== sourceAttachmentRef)
    throw new TypeError("user_meta backwrite attachmentRef must match result.sourceAttachmentRef");
  if (!isCanonicalMessageTimestamp(createdAt)) {
    throw new TypeError("user_meta backwrite createdAt must be a canonical ISO timestamp");
  }
  return {
    userMetaSourceMessageUid,
    attachmentRef: sourceAttachmentRef,
    result: cloneJson(result),
    status: STATUS_PENDING,
    createdAt,
  };
}

export function isSameUserMetaBackwrite(left, right) {
  return backwriteKey(left) === backwriteKey(right);
}

export function normalizeUserMetaBackwrites(records = []) {
  if (!Array.isArray(records)) throw new TypeError("userMetaBackwrites must be an array");
  const seen = new Set();
  return records.map((record) => {
    if (!isPlainObject(record) || !isCanonicalMessageTimestamp(record.createdAt)) {
      throw new TypeError("stored user_meta backwrite requires a canonical createdAt");
    }
    if (record.status !== STATUS_PENDING) {
      throw new TypeError("stored user_meta backwrite status must be pending");
    }
    const normalized = createUserMetaBackwrite(record);
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
