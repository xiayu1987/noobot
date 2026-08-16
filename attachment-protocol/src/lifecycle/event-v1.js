/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity, sameAttachmentIdentity } from "../identity.js";
import { ATTACHMENT_RELATION_TYPE, parseAttachmentRelation } from "../relation.js";
import { AttachmentProtocolError } from "../errors.js";
import {
  assertKnownFields,
  freezeDefined,
  optionalNonEmptyString,
  requireNonEmptyString,
  requirePlainObject,
} from "../protocol-utils.js";
import { ATTACHMENT_EVENT_STATUS } from "./transition-table.js";
const FIELDS = new Set([
  "eventType",
  "eventVersion",
  "messageId",
  "identity",
  "status",
  "occurredAt",
  "turnScopeId",
  "runId",
  "relation",
  "error",
]);
export function createAttachmentLifecycleEvent(value) {
  const s = requirePlainObject(value, "invalid_attachment_event");
  assertKnownFields(s, FIELDS, "unknown_attachment_event_field");
  const eventType = requireNonEmptyString(s.eventType, "invalid_attachment_event_type"),
    expected = ATTACHMENT_EVENT_STATUS[eventType];
  if (!expected) throw new AttachmentProtocolError("unsupported_attachment_event_type");
  if (s.status !== expected) throw new AttachmentProtocolError("attachment_event_status_mismatch");
  if ((s.eventVersion ?? 1) !== 1)
    throw new AttachmentProtocolError("unsupported_attachment_event_version");
  const identity = parseAttachmentIdentity(s.identity);
  let relation;
  if (s.relation !== undefined) relation = parseAttachmentRelation(s.relation);
  if (eventType === "attachment.parsed") {
    if (!relation || relation.relationType !== ATTACHMENT_RELATION_TYPE.PARSED_RESULT)
      throw new AttachmentProtocolError("attachment_parsed_relation_required");
    if (!sameAttachmentIdentity(relation.sourceIdentity, identity))
      throw new AttachmentProtocolError("attachment_event_relation_identity_mismatch");
  } else if (relation !== undefined)
    throw new AttachmentProtocolError("unexpected_attachment_event_relation");
  let error;
  if (s.error !== undefined) {
    const e = requirePlainObject(s.error, "invalid_attachment_event_error");
    error = freezeDefined({
      code: requireNonEmptyString(e.code, "invalid_attachment_event_error_code"),
    });
  }
  return freezeDefined({
    eventType,
    eventVersion: 1,
    messageId: requireNonEmptyString(s.messageId, "invalid_attachment_event_message_id"),
    identity,
    status: expected,
    occurredAt: requireNonEmptyString(s.occurredAt, "invalid_attachment_event_occurred_at"),
    turnScopeId: optionalNonEmptyString(s.turnScopeId, "invalid_attachment_turn_scope_id"),
    runId: optionalNonEmptyString(s.runId, "invalid_attachment_run_id"),
    relation,
    error,
  });
}
