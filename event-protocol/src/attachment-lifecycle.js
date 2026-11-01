/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AttachmentProtocolError,
  canTransitionAttachmentLifecycle,
  sameAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { isPlainObject, stableValue } from "@noobot/shared/value";
import { EVENT_FAMILY, validateProtocolEvent } from "./event-registry.js";

export function requireAttachmentLifecycleEnvelope(envelope) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid || validation.descriptor.family !== EVENT_FAMILY.ATTACHMENT_LIFECYCLE) {
    throw new AttachmentProtocolError("invalid_attachment_lifecycle_envelope");
  }
  return envelope;
}

function assertSameEvent(previous, envelope) {
  if (JSON.stringify(stableValue(previous)) !== JSON.stringify(stableValue(envelope))) {
    throw new AttachmentProtocolError("attachment_lifecycle_event_conflict");
  }
}

export function reduceAttachmentLifecycle(current, envelopeValue) {
  const envelope = requireAttachmentLifecycleEnvelope(envelopeValue);
  const event = envelope.payload;
  const eventId = envelope.identity.eventId;
  if (current !== undefined && current !== null) {
    if (
      !isPlainObject(current) ||
      !Array.isArray(current.events) ||
      !Array.isArray(current.relations)
    ) {
      throw new AttachmentProtocolError("invalid_attachment_lifecycle_state");
    }
    if (!sameAttachmentIdentity(current.identity, event.identity)) {
      throw new AttachmentProtocolError("attachment_lifecycle_identity_mismatch");
    }
    const previous = current.events.find((item) => item.identity.eventId === eventId);
    if (previous) {
      assertSameEvent(previous, envelope);
      return current;
    }
    if (!canTransitionAttachmentLifecycle(current.status, event.status)) {
      throw new AttachmentProtocolError("invalid_attachment_lifecycle_transition");
    }
  }
  const relations = current ? current.relations : [];
  return Object.freeze({
    identity: event.identity,
    status: event.status,
    events: Object.freeze([...(current ? current.events : []), structuredClone(envelope)]),
    relations: Object.freeze(
      event.relation
        ? [
            ...relations.filter(
              (relation) => relation.relationType !== event.relation.relationType,
            ),
            event.relation,
          ]
        : [...relations],
    ),
  });
}
