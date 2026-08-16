/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentProtocolError } from "./errors.js";
import {
  assertKnownFields,
  freezeDefined,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
const FIELDS = new Set(["attachmentId", "sessionId", "attachmentSource"]);
export function parseAttachmentIdentity(value) {
  const source = requirePlainObject(value, "invalid_attachment_identity");
  assertKnownFields(source, FIELDS, "unknown_attachment_identity_field");
  return freezeDefined({
    attachmentId: requireNonEmptyString(source.attachmentId, "invalid_attachment_id"),
    sessionId: requireNonEmptyString(source.sessionId, "invalid_attachment_session_id"),
    attachmentSource: requireNonEmptyString(source.attachmentSource, "invalid_attachment_source"),
  });
}
export const createAttachmentIdentity = parseAttachmentIdentity;
export function projectAttachmentIdentity(value) {
  const source = requirePlainObject(value, "invalid_attachment_metadata");
  return parseAttachmentIdentity({
    attachmentId: source.attachmentId,
    sessionId: source.sessionId,
    attachmentSource: source.attachmentSource,
  });
}
export function attachmentIdentityKey(value) {
  const i = parseAttachmentIdentity(value);
  return JSON.stringify([i.sessionId, i.attachmentSource, i.attachmentId]);
}
export function sameAttachmentIdentity(a, b) {
  return attachmentIdentityKey(a) === attachmentIdentityKey(b);
}
export function assertAttachmentBelongsToScope(value, scope) {
  const i = parseAttachmentIdentity(value);
  const s = requirePlainObject(scope, "invalid_attachment_scope");
  if (i.sessionId !== s.sessionId || i.attachmentSource !== s.attachmentSource)
    throw new AttachmentProtocolError("attachment_scope_identity_mismatch");
  return i;
}
