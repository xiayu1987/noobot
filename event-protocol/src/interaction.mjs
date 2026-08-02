/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

export const INTERACTION_EVENT_TYPE = Object.freeze({
  REQUEST: "interaction_request",
  RESPONSE: "interaction_response",
});

export function validateInteractionRequestPayload(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, reason: "payload_not_object", missing: [] };
  }
  const required = ["requestId", "sessionId", "dialogProcessId", "turnScopeId"];
  const missing = required.filter((key) => !clean(data[key]));
  const hasPayload = typeof data.content === "string"
    || Array.isArray(data.fields)
    || Boolean(clean(data.interactionType))
    || (data.interactionData && typeof data.interactionData === "object" && !Array.isArray(data.interactionData));
  if (missing.length) return { valid: false, reason: "missing_identity", missing };
  if (!hasPayload) return { valid: false, reason: "missing_payload", missing: [] };
  return { valid: true, reason: "", missing: [] };
}

export function validateInteractionRequest(event = {}) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : event;
  return validateInteractionRequestPayload(payload);
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
  const eventType = clean(
    record?.identity?.eventType ?? record?.eventType ?? record?.event,
  );
  if (eventType !== INTERACTION_EVENT_TYPE.REQUEST) return false;
  const payload = record?.payload && typeof record.payload === "object"
    ? record.payload
    : record?.data && typeof record.data === "object"
      ? record.data
      : record;
  return validateInteractionRequestPayload(payload).valid;
}

export function validateInteractionResponsePayload(data = {}) {
  const missing = ["requestId", "sessionId", "dialogProcessId", "turnScopeId"]
    .filter((key) => !clean(data?.[key]));
  return missing.length
    ? { valid: false, reason: "missing_identity", missing }
    : { valid: true, reason: "", missing: [] };
}
