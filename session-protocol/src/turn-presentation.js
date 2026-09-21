/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "./normalize.js";

export function canonicalAssistantPresentationIdentity(message = {}) {
  if (clean(message?.role) !== "assistant" || message?.chatPresentation !== true) return null;
  return Object.freeze({
    turnScopeId: clean(message?.turnScopeId),
    presentationMessageId: clean(message?.presentationMessageId),
  });
}

export function validateCanonicalAssistantPresentation(message = {}) {
  const identity = canonicalAssistantPresentationIdentity(message);
  if (!identity) return Object.freeze({ applicable: false, valid: true, errors: [] });
  const errors = [];
  if (!identity.turnScopeId) errors.push("missing_canonical_presentation_turn_scope");
  if (!identity.presentationMessageId) {
    errors.push("missing_canonical_presentation_message_id");
  }
  return Object.freeze({
    applicable: true,
    valid: errors.length === 0,
    identity,
    errors: Object.freeze(errors),
  });
}

export function assertCanonicalAssistantPresentation(message = {}) {
  const result = validateCanonicalAssistantPresentation(message);
  if (!result.valid) {
    throw new TypeError(`invalid canonical assistant presentation: ${result.errors.join(",")}`);
  }
  return message;
}
