/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { attachmentIdentityKey, parseAttachmentIdentity } from "./attachment-identity.js";
import {
  AttachmentProtocolError,
  assertKnownFields,
  freezeDefined,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";

export const ATTACHMENT_LIFECYCLE = Object.freeze({
  RECEIVED: "received",
  PERSISTED: "persisted",
  PARSING: "parsing",
  PARSED: "parsed",
  GENERATED: "generated",
  INVALID: "invalid",
  DELETED: "deleted",
});

export const ATTACHMENT_EVENT_TYPE = Object.freeze({
  RECEIVED: "attachment.received",
  PERSISTED: "attachment.persisted",
  PARSE_STARTED: "attachment.parse_started",
  PARSED: "attachment.parsed",
  GENERATED: "attachment.generated",
  INVALID: "attachment.invalid",
  DELETED: "attachment.deleted",
});

const EVENT_FIELDS = new Set([
  "eventType",
  "eventVersion",
  "messageId",
  "identity",
  "status",
  "occurredAt",
  "turnScopeId",
  "runId",
  "error",
]);
const EVENT_TYPES = new Set(Object.values(ATTACHMENT_EVENT_TYPE));
const STATUSES = new Set(Object.values(ATTACHMENT_LIFECYCLE));

export function createAttachmentLifecycleEvent(value) {
  const source = requirePlainObject(value, "invalid_attachment_event");
  assertKnownFields(source, EVENT_FIELDS, "unknown_attachment_event_field");
  const eventType = requireNonEmptyString(source.eventType, "invalid_attachment_event_type");
  if (!EVENT_TYPES.has(eventType))
    throw new AttachmentProtocolError("unsupported_attachment_event_type");
  const status = requireNonEmptyString(source.status, "invalid_attachment_event_status");
  if (!STATUSES.has(status))
    throw new AttachmentProtocolError("unsupported_attachment_event_status");
  const identity = parseAttachmentIdentity(source.identity);
  const event = freezeDefined({
    eventType,
    eventVersion: source.eventVersion === undefined ? 1 : source.eventVersion,
    messageId: requireNonEmptyString(source.messageId, "invalid_attachment_event_message_id"),
    identity,
    status,
    occurredAt: requireNonEmptyString(source.occurredAt, "invalid_attachment_event_occurred_at"),
    turnScopeId: source.turnScopeId,
    runId: source.runId,
    error: source.error,
  });
  if (!Number.isSafeInteger(event.eventVersion) || event.eventVersion !== 1) {
    throw new AttachmentProtocolError("unsupported_attachment_event_version");
  }
  if (
    event.error !== undefined &&
    (!requirePlainObject(event.error, "invalid_attachment_event_error").code ||
      !requireNonEmptyString(event.error.code, "invalid_attachment_event_error_code"))
  ) {
    throw new AttachmentProtocolError("invalid_attachment_event_error");
  }
  return event;
}

export function attachmentEventIdentityKey(event) {
  return attachmentIdentityKey(createAttachmentLifecycleEvent(event).identity);
}

export function createAttachmentSetUpdate(attachments) {
  if (attachments === undefined) return Object.freeze({ kind: "unchanged" });
  if (!Array.isArray(attachments))
    throw new AttachmentProtocolError("attachments_must_be_array_or_undefined");
  const identities = attachments.map(parseAttachmentIdentity);
  const keys = new Set();
  for (const identity of identities) {
    const key = attachmentIdentityKey(identity);
    if (keys.has(key)) throw new AttachmentProtocolError("duplicate_attachment_identity");
    keys.add(key);
  }
  return Object.freeze({ kind: "replace", identities: Object.freeze(identities) });
}
