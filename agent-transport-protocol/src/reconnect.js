/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";
import { CHANNEL_IDENTITY_KEYS } from "./constants.js";

export const RECONNECT_CONTROL_ACTION = "reconnect";
export const RECONNECT_CONTROL_PROTOCOL_VERSION = 1;

const TOP_LEVEL_KEYS = new Set([
  "action",
  "protocolVersion",
  "requestId",
  "identity",
  "knownLifecycleSequenceMap",
]);
const IDENTITY_KEYS = new Set(CHANNEL_IDENTITY_KEYS);

export function createReconnectControl({ requestId, identity, knownLifecycleSequenceMap }) {
  return parseReconnectControl({
    action: RECONNECT_CONTROL_ACTION,
    protocolVersion: RECONNECT_CONTROL_PROTOCOL_VERSION,
    requestId,
    identity,
    knownLifecycleSequenceMap,
  });
}

function rejectUnknownKeys(value, allowedKeys, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`unknown_field:${path}${key}`);
  }
}

function validateReconnectIdentity(identity, errors) {
  if (!isPlainObject(identity)) {
    errors.push("identity_not_object");
    return;
  }
  rejectUnknownKeys(identity, IDENTITY_KEYS, "identity.", errors);
  for (const key of IDENTITY_KEYS) {
    const value = identity[key];
    if (typeof value !== "string" || value !== value.trim()) {
      errors.push(`invalid_identity_field:${key}`);
    }
  }
  if (!identity.sessionId && identity.parentSessionId) {
    errors.push("parent_identity_requires_session_id");
  }
}

function validateSequenceMap(sequenceMap, errors) {
  if (!isPlainObject(sequenceMap)) {
    errors.push("known_lifecycle_sequence_map_not_object");
    return;
  }
  for (const [sessionId, sequence] of Object.entries(sequenceMap)) {
    if (!text(sessionId) || !Number.isSafeInteger(sequence) || sequence < 1) {
      errors.push(`invalid_known_lifecycle_sequence:${sessionId}`);
    }
  }
}

export function validateReconnectControl(control = {}) {
  const errors = [];
  if (!isPlainObject(control)) return { valid: false, errors: ["control_not_object"] };
  rejectUnknownKeys(control, TOP_LEVEL_KEYS, "", errors);
  if (control.action !== RECONNECT_CONTROL_ACTION) errors.push("invalid_action");
  if (control.protocolVersion !== RECONNECT_CONTROL_PROTOCOL_VERSION) {
    errors.push("unsupported_protocol_version");
  }
  validateRequestId(control.requestId, errors);
  validateReconnectIdentity(control.identity, errors);
  validateSequenceMap(control.knownLifecycleSequenceMap, errors);
  return { valid: errors.length === 0, errors };
}

export class ReconnectControlProtocolError extends Error {
  constructor(errors = []) {
    super(`invalid_reconnect_control: ${errors.join(", ")}`);
    this.name = "ReconnectControlProtocolError";
    this.code = "INVALID_RECONNECT_CONTROL";
    this.errors = [...errors];
    this.statusCode = 400;
  }
}

export function parseReconnectControl(control) {
  const validation = validateReconnectControl(control);
  if (!validation.valid) throw new ReconnectControlProtocolError(validation.errors);
  return control;
}

export function readKnownLifecycleSequence(control, sessionId) {
  const sequenceMap = control.knownLifecycleSequenceMap;
  return Object.hasOwn(sequenceMap, sessionId) ? sequenceMap[sessionId] : 0;
}

const RECONNECT_DATA_KEYS = new Set(["requestId", "identity", "sessions"]);
const RECONNECT_SESSION_KEYS = new Set(["sessionId", "replayBatch"]);
const RECONNECT_COMPLETE_KEYS = new Set(["requestId", "totalSessions"]);

function validateRequestId(requestId, errors) {
  if (typeof requestId !== "string" || !requestId) {
    errors.push("missing_request_id");
  } else if (requestId !== requestId.trim()) {
    errors.push("invalid_request_id");
  }
}

function validateReconnectSession(session, index, errors) {
  if (!isPlainObject(session)) {
    errors.push(`session_not_object:${index}`);
    return;
  }
  rejectUnknownKeys(session, RECONNECT_SESSION_KEYS, `sessions.${index}.`, errors);
  const { sessionId } = session;
  if (typeof sessionId !== "string" || !sessionId || sessionId !== sessionId.trim()) {
    errors.push(`invalid_session_id:${index}`);
  }
  if (!isPlainObject(session.replayBatch)) errors.push(`replay_batch_not_object:${index}`);
}

export function validateReconnectData(data) {
  const errors = [];
  if (!isPlainObject(data)) return { valid: false, errors: ["reconnect_data_not_object"] };
  rejectUnknownKeys(data, RECONNECT_DATA_KEYS, "", errors);
  validateRequestId(data.requestId, errors);
  validateReconnectIdentity(data.identity, errors);
  if (!Array.isArray(data.sessions)) {
    errors.push("sessions_not_array");
  } else {
    data.sessions.forEach((session, index) => validateReconnectSession(session, index, errors));
  }
  return { valid: errors.length === 0, errors };
}

export function validateReconnectComplete(data) {
  const errors = [];
  if (!isPlainObject(data)) return { valid: false, errors: ["reconnect_complete_not_object"] };
  rejectUnknownKeys(data, RECONNECT_COMPLETE_KEYS, "", errors);
  validateRequestId(data.requestId, errors);
  if (!Number.isSafeInteger(data.totalSessions) || data.totalSessions < 0) {
    errors.push("invalid_total_sessions");
  }
  return { valid: errors.length === 0, errors };
}

export function parseReconnectData(data) {
  const validation = validateReconnectData(data);
  if (!validation.valid) throw new ReconnectControlProtocolError(validation.errors);
  return data;
}

export function parseReconnectComplete(data) {
  const validation = validateReconnectComplete(data);
  if (!validation.valid) throw new ReconnectControlProtocolError(validation.errors);
  return data;
}

export function createReconnectData(control, sessions) {
  return parseReconnectData({
    requestId: control.requestId,
    identity: control.identity,
    sessions,
  });
}

export function createReconnectComplete(control, sessions) {
  return parseReconnectComplete({
    requestId: control.requestId,
    totalSessions: sessions.length,
  });
}
