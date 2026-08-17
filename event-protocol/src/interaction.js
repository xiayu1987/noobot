/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

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
  const normalized = clean(value).toLowerCase();
  return Object.values(INTERACTION_LIFECYCLE).includes(normalized)
    ? normalized
    : INTERACTION_LIFECYCLE.PENDING;
}

export function normalizeInteractionResolvedBy(value = "") {
  const normalized = clean(value).toLowerCase();
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
  const missing = required.filter((key) => !clean(data[key]));
  const hasPayload =
    typeof data.content === "string" ||
    Array.isArray(data.fields) ||
    Boolean(clean(data.interactionType)) ||
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
    clean(data.lifecycle).toLowerCase() !== lifecycle
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

/**
 * Returns true only for a complete interaction record in a replay stream.
 *
 * Replay transport envelopes are intentionally accepted here because the
 * protocol package is the single place that knows how an interaction request
 * is represented on the wire.  An incomplete interaction must not survive
 * sequence filtering and become a client-side pending state.
 */
export function isPendingInteractionReplay(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const eventType = clean(record?.identity?.eventType);
  if (eventType !== INTERACTION_EVENT_TYPE.REQUEST) return false;
  const payload = record?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const validation = validateInteractionRequestPayload(payload);
  return (
    validation.valid &&
    normalizeInteractionLifecycle(payload.lifecycle) ===
      INTERACTION_LIFECYCLE.PENDING
  );
}

export function validateInteractionResponsePayload(data = {}) {
  const missing = ["requestId", "dialogProcessId"].filter(
    (key) => !clean(data?.[key]),
  );
  return missing.length
    ? { valid: false, reason: "missing_identity", missing }
    : { valid: true, reason: "", missing: [] };
}
