/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentProtocolError } from "../errors.js";
import { assertAttachmentBelongsToScope } from "../identity.js";
import { requireNonEmptyString, requirePlainObject } from "../protocol-utils.js";
import { parsePersistedAttachmentRecord } from "./record-v1.js";
export * from "./record-v1.js";

export function parsePersistedAttachmentIndex(value, scope) {
  const index = requirePlainObject(value, "invalid_attachment_index");
  if (index.sessionId !== scope.sessionId || index.attachmentSource !== scope.attachmentSource)
    throw new AttachmentProtocolError("attachment_index_scope_mismatch");
  const entries = requirePlainObject(index.attachments, "invalid_attachment_index_entries");
  const attachments = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => {
      const record = parsePersistedAttachmentRecord(value);
      assertAttachmentBelongsToScope(record.identity, scope);
      if (key !== record.identity.attachmentId)
        throw new AttachmentProtocolError("attachment_index_key_mismatch");
      return [key, record];
    }),
  );
  return Object.freeze({
    updatedAt: requireNonEmptyString(index.updatedAt, "invalid_attachment_index_updated_at"),
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    attachments: Object.freeze(attachments),
  });
}
