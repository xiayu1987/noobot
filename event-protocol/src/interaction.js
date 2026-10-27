/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";
import {
  createSessionPersistenceScope,
  createSessionScope,
  createTurnIdentity,
  validateSessionPersistenceScope,
  validateSessionScope,
  validateTurnIdentity,
} from "@noobot/session-protocol";

const INTERACTION_AUTHORITY_FIELDS = Object.freeze(["session", "turn", "persistenceScope"]);
const TURN_IDENTITY_FIELDS = Object.freeze(["dialogProcessId", "turnScopeId"]);

export function createInteractionAuthority(source) {
  if (!isPlainObject(source)) {
    throw new TypeError("interaction authority must be an object");
  }
  return Object.freeze({
    session: createSessionScope(source.session),
    turn: createTurnIdentity(source.turn),
    persistenceScope: createSessionPersistenceScope(source.persistenceScope),
  });
}

export function validateInteractionAuthority(source) {
  if (!isPlainObject(source)) {
    return { valid: false, errors: ["invalid_interaction_authority"] };
  }
  const errors = [
    ...validateSessionScope(source.session).errors,
    ...validateTurnIdentity(source.turn).errors,
  ];
  if (Object.keys(source).some((key) => !INTERACTION_AUTHORITY_FIELDS.includes(key))) {
    errors.push("unknown_interaction_authority_field");
  }
  if (
    isPlainObject(source.turn) &&
    Object.keys(source.turn).some((key) => !TURN_IDENTITY_FIELDS.includes(key))
  ) {
    errors.push("unknown_turn_identity_field");
  }
  const scopeValidation = validateSessionPersistenceScope(source.persistenceScope);
  errors.push(...scopeValidation.errors);

  if (
    scopeValidation.scope &&
    scopeValidation.scope.parentSessionId !== createSessionScope(source.session).parentSessionId
  ) {
    errors.push("persistence_scope_parent_mismatch");
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors, authority: createInteractionAuthority(source) };
}

export const INTERACTION_LIFECYCLE = Object.freeze({
  PENDING: "pending",
  RESOLVED: "resolved",
  FAILED: "failed",
});

const INTERACTION_RESOLVED_BY = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  AUTO: "auto",
});

export function normalizeInteractionLifecycle(value = "") {
  const normalized = text(value).toLowerCase();
  return Object.values(INTERACTION_LIFECYCLE).includes(normalized)
    ? normalized
    : INTERACTION_LIFECYCLE.PENDING;
}

export function normalizeInteractionResolvedBy(value = "") {
  const normalized = text(value).toLowerCase();
  return Object.values(INTERACTION_RESOLVED_BY).includes(normalized) ? normalized : "";
}

export function isTerminalInteractionLifecycle(value = "") {
  const lifecycle = normalizeInteractionLifecycle(value);
  return lifecycle === INTERACTION_LIFECYCLE.RESOLVED || lifecycle === INTERACTION_LIFECYCLE.FAILED;
}

export const INTERACTION_EVENT_TYPE = Object.freeze({
  REQUEST: "interaction_request",
  RESPONSE: "interaction_response",
});

export const INTERACTION_SEQUENCE_DOMAIN = "interaction";

const INTERACTION_IDENTITY_ERRORS = Object.freeze([
  ["requestId", "missing_request_id"],
  ["dialogProcessId", "missing_dialog_process_id"],
]);
const VALID_INTERACTION_PAYLOAD = Object.freeze({ valid: true, errors: Object.freeze([]) });
const invalidInteractionPayload = (errors) =>
  Object.freeze({ valid: false, errors: Object.freeze(errors) });

function collectInteractionIdentityErrors(data) {
  return INTERACTION_IDENTITY_ERRORS.filter(([key]) => !text(data[key])).map(([, code]) => code);
}

export function validateInteractionRequestPayload(data) {
  if (!isPlainObject(data)) return invalidInteractionPayload(["payload_not_object"]);
  const identityErrors = collectInteractionIdentityErrors(data);
  if (identityErrors.length) return invalidInteractionPayload(identityErrors);
  const hasPayload =
    typeof data.content === "string" ||
    Array.isArray(data.fields) ||
    Boolean(text(data.interactionType)) ||
    isPlainObject(data.interactionData);
  if (!hasPayload) return invalidInteractionPayload(["missing_payload"]);
  if (data.timeoutMs !== undefined && (!Number.isInteger(data.timeoutMs) || data.timeoutMs <= 0)) {
    return invalidInteractionPayload(["invalid_timeout_ms"]);
  }
  if (Object.hasOwn(data, "ackMode"))
    return invalidInteractionPayload(["retired_interaction_ack_mode"]);
  const interactionData = data.interactionData;
  if (
    isObjectLike(interactionData) &&
    ["lifecycle", "resolvedBy", "notification"].some((key) => Object.hasOwn(interactionData, key))
  ) {
    return invalidInteractionPayload(["noncanonical_interaction_control"]);
  }
  const lifecycle = normalizeInteractionLifecycle(data.lifecycle);
  if (
    text(data.lifecycle) &&
    lifecycle === INTERACTION_LIFECYCLE.PENDING &&
    text(data.lifecycle).toLowerCase() !== lifecycle
  ) {
    return invalidInteractionPayload(["invalid_lifecycle"]);
  }
  const resolvedBy = normalizeInteractionResolvedBy(data.resolvedBy);
  if (isTerminalInteractionLifecycle(lifecycle) && !resolvedBy) {
    return invalidInteractionPayload(["missing_terminal_resolved_by"]);
  }
  return VALID_INTERACTION_PAYLOAD;
}

export function validateInteractionResponsePayload(data) {
  if (!isPlainObject(data)) return invalidInteractionPayload(["payload_not_object"]);
  const identityErrors = collectInteractionIdentityErrors(data);
  return identityErrors.length
    ? invalidInteractionPayload(identityErrors)
    : VALID_INTERACTION_PAYLOAD;
}
