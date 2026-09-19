/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "./normalize.js";
import {
  createSessionScope,
  createTurnIdentity,
  validateSessionScope,
  validateTurnIdentity,
} from "@noobot/session-protocol";

const INTERACTION_AUTHORITY_FIELDS = Object.freeze(["session", "turn", "persistenceScope"]);
const TURN_IDENTITY_FIELDS = Object.freeze(["dialogProcessId", "turnScopeId"]);
const PERSISTENCE_SCOPE_FIELDS = Object.freeze([
  "scopeId",
  "parentSessionId",
  "relativeDir",
  "allowedRoot",
]);

function normalizePersistenceScope(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze(
    Object.fromEntries(PERSISTENCE_SCOPE_FIELDS.map((field) => [field, text(value[field])])),
  );
}

export function createInteractionAuthority(source = {}) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return Object.freeze({
    session: createSessionScope(input.session),
    turn: createTurnIdentity(input.turn),
    persistenceScope: normalizePersistenceScope(input.persistenceScope),
  });
}

export function validateInteractionAuthority(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { valid: false, errors: ["invalid_interaction_authority"] };
  }
  const authority = createInteractionAuthority(source);
  const errors = [
    ...validateSessionScope(source.session).errors,
    ...validateTurnIdentity(source.turn).errors,
  ];
  if (Object.keys(source).some((key) => !INTERACTION_AUTHORITY_FIELDS.includes(key))) {
    errors.push("unknown_interaction_authority_field");
  }
  if (
    source.turn &&
    typeof source.turn === "object" &&
    !Array.isArray(source.turn) &&
    Object.keys(source.turn).some((key) => !TURN_IDENTITY_FIELDS.includes(key))
  ) {
    errors.push("unknown_turn_identity_field");
  }
  if (source.persistenceScope != null) {
    const persistenceScope = source.persistenceScope;
    if (
      !persistenceScope ||
      typeof persistenceScope !== "object" ||
      Array.isArray(persistenceScope)
    ) {
      errors.push("invalid_persistence_scope");
    } else {
      if (Object.keys(persistenceScope).some((key) => !PERSISTENCE_SCOPE_FIELDS.includes(key))) {
        errors.push("unknown_persistence_scope_field");
      }
      if (PERSISTENCE_SCOPE_FIELDS.some((field) => !authority.persistenceScope[field])) {
        errors.push("incomplete_persistence_scope");
      }
      if (authority.persistenceScope.parentSessionId !== authority.session.parentSessionId) {
        errors.push("persistence_scope_parent_mismatch");
      }
    }
  }
  return { valid: errors.length === 0, errors, authority };
}

export const INTERACTION_LIFECYCLE = Object.freeze({
  PENDING: "pending",
  RESOLVED: "resolved",
  FAILED: "failed",
});

export const INTERACTION_RESOLVED_BY = Object.freeze({
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

export function validateInteractionRequestPayload(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, reason: "payload_not_object", missing: [] };
  }
  const required = ["requestId", "dialogProcessId"];
  const missing = required.filter((key) => !text(data[key]));
  const hasPayload =
    typeof data.content === "string" ||
    Array.isArray(data.fields) ||
    Boolean(text(data.interactionType)) ||
    (data.interactionData &&
      typeof data.interactionData === "object" &&
      !Array.isArray(data.interactionData));
  if (missing.length) return { valid: false, reason: "missing_identity", missing };
  if (!hasPayload) return { valid: false, reason: "missing_payload", missing: [] };
  if (data.timeoutMs !== undefined && (!Number.isInteger(data.timeoutMs) || data.timeoutMs <= 0)) {
    return { valid: false, reason: "invalid_timeout_ms", missing: [] };
  }
  const interactionData = data.interactionData;
  if (
    interactionData &&
    typeof interactionData === "object" &&
    ["lifecycle", "resolvedBy", "ackMode", "notification"].some((key) =>
      Object.hasOwn(interactionData, key),
    )
  ) {
    return { valid: false, reason: "noncanonical_interaction_control", missing: [] };
  }
  const lifecycle = normalizeInteractionLifecycle(data.lifecycle);
  if (
    String(data.lifecycle || "").trim() &&
    lifecycle === INTERACTION_LIFECYCLE.PENDING &&
    text(data.lifecycle).toLowerCase() !== lifecycle
  ) {
    return { valid: false, reason: "invalid_lifecycle", missing: [] };
  }
  const resolvedBy = normalizeInteractionResolvedBy(data.resolvedBy);
  if (isTerminalInteractionLifecycle(lifecycle) && !resolvedBy) {
    return { valid: false, reason: "missing_terminal_resolved_by", missing: ["resolvedBy"] };
  }
  return { valid: true, reason: "", missing: [] };
}

export function validateInteractionRequest(event = {}) {
  return validateInteractionRequestPayload(event?.payload);
}

export function isPendingInteractionReplay(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const eventType = text(record?.identity?.eventType);
  if (eventType !== INTERACTION_EVENT_TYPE.REQUEST) return false;
  const payload = record?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const validation = validateInteractionRequestPayload(payload);
  return (
    validation.valid &&
    normalizeInteractionLifecycle(payload.lifecycle) === INTERACTION_LIFECYCLE.PENDING
  );
}

export function validateInteractionResponsePayload(data = {}) {
  const missing = ["requestId", "dialogProcessId"].filter((key) => !text(data?.[key]));
  return missing.length
    ? { valid: false, reason: "missing_identity", missing }
    : { valid: true, reason: "", missing: [] };
}
