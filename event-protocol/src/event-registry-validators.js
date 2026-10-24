/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText } from "@noobot/shared/value";
import {
  ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
  attachmentLifecycleSequenceScopeId,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";
import { INTERACTION_SEQUENCE_DOMAIN } from "./interaction.js";
import { SESSION_SEQUENCE_DOMAIN } from "./turn-snapshot.js";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  TRANSIENT_MESSAGE_EVENT_SEQUENCE,
  isTransientMessageEventType,
} from "./message-event.js";

export const domainResult = (result, fallback = "invalid_domain_payload") => {
  if (result?.valid === true) return { valid: true, errors: [] };
  const errors =
    Array.isArray(result?.errors) && result.errors.length
      ? result.errors
      : Array.isArray(result?.missing) && result.missing.length
        ? result.missing
        : [result?.reason || fallback];
  return { valid: false, errors };
};

export const validateAttachment = (payload) => {
  try {
    createAttachmentLifecycleEvent(payload);
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error?.message || "invalid_attachment_lifecycle"] };
  }
};

export const validateAttachmentEnvelope = (envelope) => {
  const { identity, ordering, payload } = envelope;
  const errors = [];
  if (ordering.domain !== ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN)
    errors.push("sequence_domain_mismatch");
  if (ordering.scopeId !== attachmentLifecycleSequenceScopeId(payload.identity))
    errors.push("sequence_scope_mismatch");
  if (identity.turnScopeId !== payload.turnScopeId) errors.push("turn_scope_id_mismatch");
  return { valid: errors.length === 0, errors };
};

export const validateInteractionEnvelope = (envelope) => {
  const errors = [];
  if (!isCanonicalText(envelope.identity.turnScopeId)) errors.push("missing_turn_scope_id");
  if (envelope.ordering.domain !== INTERACTION_SEQUENCE_DOMAIN)
    errors.push("sequence_domain_mismatch");
  if (envelope.ordering.scopeId !== envelope.payload.requestId)
    errors.push("sequence_scope_mismatch");
  return { valid: errors.length === 0, errors };
};

const TURN_LIFECYCLE_ALIGNED_FIELDS = Object.freeze([
  ["identity", "eventId", "eventId"],
  ["identity", "sessionId", "sessionId"],
  ["identity", "turnScopeId", "turnScopeId"],
  ["causality", "commandId", "commandId"],
  ["causality", "causationId", "causationId"],
  ["causality", "correlationId", "correlationId"],
  ["ordering", "scopeId", "sessionId"],
  ["ordering", "sequence", "sequence"],
  ["ordering", "revision", "revision"],
]);

export const validateTurnLifecycleEventEnvelope = (envelope) => {
  const { payload } = envelope;
  const errors = [];
  if (!isCanonicalText(envelope.causality.commandId)) errors.push("missing_command_id");
  if (envelope.ordering.domain !== SESSION_SEQUENCE_DOMAIN) errors.push("sequence_domain_mismatch");
  for (const [section, field, payloadField] of TURN_LIFECYCLE_ALIGNED_FIELDS) {
    if (envelope[section][field] !== payload[payloadField]) {
      errors.push(`lifecycle_${section}_${field}_mismatch`);
    }
  }
  return { valid: errors.length === 0, errors };
};

const MESSAGE_FORBIDDEN_ORDERING_FIELDS = Object.freeze(["revision", "aggregateVersion"]);

const collectMessageOrderingErrors = (envelope, errors) => {
  const { ordering, payload } = envelope;
  if (ordering.domain !== MESSAGE_EVENT_SEQUENCE_DOMAIN) errors.push("sequence_domain_mismatch");
  if (ordering.scopeId !== payload.presentationMessageId) errors.push("sequence_scope_mismatch");
  for (const field of MESSAGE_FORBIDDEN_ORDERING_FIELDS) {
    if (Object.hasOwn(ordering, field)) errors.push(`message_ordering_${field}_forbidden`);
  }
  const sequence = ordering?.sequence;
  if (isTransientMessageEventType(envelope?.payload?.eventType)) {
    if (sequence !== TRANSIENT_MESSAGE_EVENT_SEQUENCE) errors.push("transient_event_sequenced");
  } else if (!(sequence >= 1)) {
    errors.push("durable_event_unsequenced");
  }
};

const collectPresentationIdentityErrors = (envelope, errors) => {
  const { identity, payload } = envelope;
  for (const role of ["user", "assistant"]) {
    const message = payload.presentation[`${role}Message`];
    if (message.sessionId !== identity.sessionId) {
      errors.push(`${role}_session_identity_mismatch`);
    }
    if (message.turnScopeId !== identity.turnScopeId) {
      errors.push(`${role}_turn_identity_mismatch`);
    }
  }
};

const collectInterjectionIdentityErrors = (envelope, errors) => {
  const { identity, payload, causality } = envelope;
  const fact = payload.contentFact;
  if (!isCanonicalText(causality.commandId)) errors.push("missing_interjection_command_id");
  if (causality.causationId !== causality.commandId) {
    errors.push("interjection_causation_identity_mismatch");
  }
  for (const [factField, envelopeValue] of [
    ["sessionId", identity.sessionId],
    ["turnScopeId", identity.turnScopeId],
    ["presentationMessageId", payload.presentationMessageId],
    ["dialogProcessId", payload.dialogProcessId],
  ]) {
    if (fact[factField] !== envelopeValue) {
      errors.push(`interjection_${factField}_mismatch`);
    }
  }
};

export const validateMessageEnvelope = (envelope) => {
  const errors = [];
  if (!isCanonicalText(envelope.identity.turnScopeId)) errors.push("missing_turn_scope_id");
  collectMessageOrderingErrors(envelope, errors);
  const eventType = envelope?.payload?.eventType;
  if (eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    collectPresentationIdentityErrors(envelope, errors);
  }
  if (eventType === MESSAGE_EVENT_TYPE.USER_INTERJECTION) {
    collectInterjectionIdentityErrors(envelope, errors);
  }
  return { valid: errors.length === 0, errors };
};
