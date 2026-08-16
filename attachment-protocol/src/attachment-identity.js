/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertKnownFields,
  freezeDefined,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";

const IDENTITY_FIELDS = new Set(["attachmentId", "sessionId", "attachmentSource"]);

export function parseAttachmentIdentity(value) {
  const source = requirePlainObject(value, "invalid_attachment_identity");
  assertKnownFields(source, IDENTITY_FIELDS, "unknown_attachment_identity_field");
  return freezeDefined({
    attachmentId: requireNonEmptyString(source.attachmentId, "invalid_attachment_id"),
    sessionId: requireNonEmptyString(source.sessionId, "invalid_attachment_session_id"),
    attachmentSource: requireNonEmptyString(source.attachmentSource, "invalid_attachment_source"),
  });
}

export function createAttachmentIdentity(value) {
  return parseAttachmentIdentity(value);
}

export function projectAttachmentIdentity(value) {
  const source = requirePlainObject(value, "invalid_attachment_metadata");
  return parseAttachmentIdentity({
    attachmentId: source.attachmentId,
    sessionId: source.sessionId,
    attachmentSource: source.attachmentSource,
  });
}

export function attachmentIdentityKey(value) {
  const identity = parseAttachmentIdentity(value);
  return JSON.stringify([identity.sessionId, identity.attachmentSource, identity.attachmentId]);
}

export function sameAttachmentIdentity(left, right) {
  return attachmentIdentityKey(left) === attachmentIdentityKey(right);
}
