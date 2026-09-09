/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateExecutionIdentity } from "@noobot/session-protocol";
import { createAttachmentLifecycleEvent } from "@noobot/attachment-protocol";
import { INTERACTION_SEQUENCE_DOMAIN } from "./interaction.js";
import { MESSAGE_EVENT_SEQUENCE_DOMAIN, MESSAGE_EVENT_TYPE } from "./message-event.js";
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

export const validateMessageEnvelope = (envelope) => {
  const errors = [];
  const messageId = text(envelope?.identity?.messageId);
  if (!messageId) errors.push("missing_message_id");
  if (envelope?.ordering?.domain !== MESSAGE_EVENT_SEQUENCE_DOMAIN) {
    errors.push("sequence_domain_mismatch");
  }
  if (messageId && envelope?.ordering?.scopeId !== messageId) {
    errors.push("sequence_scope_mismatch");
  }
  if (envelope?.payload?.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    for (const role of ["user", "assistant"]) {
      const message = envelope?.payload?.presentation?.[`${role}Message`];
      if (text(message?.sessionId) !== text(envelope?.identity?.sessionId)) {
        errors.push(`${role}_session_identity_mismatch`);
      }
      if (text(message?.turnScopeId) !== text(envelope?.identity?.turnScopeId)) {
        errors.push(`${role}_turn_identity_mismatch`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
};
