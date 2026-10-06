/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateExecutionIdentity } from "@noobot/session-protocol";
import { createAttachmentLifecycleEvent } from "@noobot/attachment-protocol";
import { INTERACTION_SEQUENCE_DOMAIN } from "./interaction.js";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  TRANSIENT_MESSAGE_EVENT_SEQUENCE,
  isTransientMessageEventType,
} from "./message-event.js";
import { text } from "./normalize.js";

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

export const validateExecutionPayload = (payload) =>
  domainResult(validateExecutionIdentity(payload));

export const validateInteractionEnvelope = (envelope) => {
  const errors = [];
  const requestId = text(envelope?.payload?.requestId);
  if (!text(envelope?.identity?.turnScopeId)) errors.push("missing_turn_scope_id");
  if (envelope?.ordering?.domain !== INTERACTION_SEQUENCE_DOMAIN)
    errors.push("sequence_domain_mismatch");
  if (requestId && envelope?.ordering?.scopeId !== requestId)
    errors.push("sequence_scope_mismatch");
  return { valid: errors.length === 0, errors };
};

const collectMessageOrderingErrors = (envelope, messageId, errors) => {
  const ordering = envelope?.ordering;
  if (!messageId) errors.push("missing_message_id");
  if (ordering?.domain !== MESSAGE_EVENT_SEQUENCE_DOMAIN) errors.push("sequence_domain_mismatch");
  if (messageId && ordering?.scopeId !== messageId) errors.push("sequence_scope_mismatch");
  const sequence = Number(ordering?.sequence);
  if (isTransientMessageEventType(envelope?.payload?.eventType)) {
    if (sequence !== TRANSIENT_MESSAGE_EVENT_SEQUENCE) errors.push("transient_event_sequenced");
  } else if (!(sequence >= 1)) {
    errors.push("durable_event_unsequenced");
  }
};

const collectPresentationIdentityErrors = (envelope, errors) => {
  const identity = envelope?.identity;
  for (const role of ["user", "assistant"]) {
    const message = envelope?.payload?.presentation?.[`${role}Message`];
    if (text(message?.sessionId) !== text(identity?.sessionId)) {
      errors.push(`${role}_session_identity_mismatch`);
    }
    if (text(message?.turnScopeId) !== text(identity?.turnScopeId)) {
      errors.push(`${role}_turn_identity_mismatch`);
    }
  }
};

const collectInterjectionIdentityErrors = (envelope, errors) => {
  const { identity, payload, causality } = envelope;
  const fact = payload.contentFact || {};
  const commandId = text(causality?.commandId);
  const sourceMessageUid = text(fact.sourceMessageUid);
  if (!commandId) errors.push("missing_interjection_command_id");
  if (text(causality?.causationId) !== commandId) {
    errors.push("interjection_causation_identity_mismatch");
  }
  if (sourceMessageUid !== `user-interjection:${commandId}`) {
    errors.push("interjection_source_identity_mismatch");
  }
  if (text(fact.contentId) !== `message:${sourceMessageUid}`) {
    errors.push("interjection_content_identity_mismatch");
  }
  for (const [factField, envelopeValue] of [
    ["sessionId", identity?.sessionId],
    ["turnScopeId", identity?.turnScopeId],
    ["messageId", identity?.messageId],
    ["presentationMessageId", payload.presentationMessageId],
    ["dialogProcessId", payload.dialogProcessId],
  ]) {
    if (text(fact[factField]) !== text(envelopeValue)) {
      errors.push(`interjection_${factField}_mismatch`);
    }
  }
};

export const validateMessageEnvelope = (envelope) => {
  const errors = [];
  collectMessageOrderingErrors(envelope, text(envelope?.identity?.messageId), errors);
  const eventType = envelope?.payload?.eventType;
  if (eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    collectPresentationIdentityErrors(envelope, errors);
  }
  if (eventType === MESSAGE_EVENT_TYPE.USER_INTERJECTION) {
    collectInterjectionIdentityErrors(envelope, errors);
  }
  return { valid: errors.length === 0, errors };
};
