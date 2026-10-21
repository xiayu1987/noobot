/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sameAttachmentIdentity } from "../identity.js";
import { AttachmentProtocolError } from "../errors.js";
import { createAttachmentLifecycleEvent } from "./event-v1.js";
import { canTransitionAttachmentLifecycle } from "./transition-table.js";
export function reduceAttachmentLifecycle(current, eventValue) {
  const event = createAttachmentLifecycleEvent(eventValue);
  if (!current)
    return Object.freeze({
      identity: event.identity,
      status: event.status,
      attachmentEventIds: Object.freeze([event.attachmentEventId]),
      relations: Object.freeze(event.relation ? [event.relation] : []),
      lastEvent: event,
    });
  if (!sameAttachmentIdentity(current.identity, event.identity))
    throw new AttachmentProtocolError("attachment_lifecycle_identity_mismatch");
  const ids = Array.isArray(current.attachmentEventIds) ? current.attachmentEventIds : [];
  if (ids.includes(event.attachmentEventId)) return current;
  if (!canTransitionAttachmentLifecycle(current.status, event.status))
    throw new AttachmentProtocolError("invalid_attachment_lifecycle_transition");
  const relations = event.relation
    ? [
        ...(current.relations || []).filter(
          (relation) => relation.relationType !== event.relation.relationType,
        ),
        event.relation,
      ]
    : [...(current.relations || [])];
  return Object.freeze({
    identity: event.identity,
    status: event.status,
    attachmentEventIds: Object.freeze([...ids, event.attachmentEventId]),
    relations: Object.freeze(relations),
    lastEvent: event,
  });
}
