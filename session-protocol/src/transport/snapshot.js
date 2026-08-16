/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionScope, validateSessionScope } from "../identity.mjs";
import { SESSION_PROTOCOL_VERSION } from "../version.mjs";

export function createSessionSnapshot({ scope, aggregateVersion, throughSequence, session, turns = [], messages = [] } = {}) {
  return Object.freeze({
    protocolVersion: SESSION_PROTOCOL_VERSION,
    scope: createSessionScope(scope),
    aggregateVersion: Number(aggregateVersion),
    throughSequence: Number(throughSequence),
    session: Object.freeze({ ...session, sessionId: createSessionScope(scope).sessionId }),
    turns: Object.freeze([...turns]),
    messages: Object.freeze([...messages]),
  });
}

export function validateSessionSnapshot(snapshot = {}) {
  const errors = [...validateSessionScope(snapshot.scope).errors];
  if (Number(snapshot.protocolVersion) !== SESSION_PROTOCOL_VERSION) errors.push("unsupported_protocol_version");
  if (!Number.isInteger(snapshot.aggregateVersion) || snapshot.aggregateVersion < 0) errors.push("invalid_aggregate_version");
  if (!Number.isInteger(snapshot.throughSequence) || snapshot.throughSequence < 0) errors.push("invalid_through_sequence");
  if (!snapshot.session || typeof snapshot.session !== "object" || Array.isArray(snapshot.session)) errors.push("invalid_session");
  else if (String(snapshot.session.sessionId || "").trim() !== String(snapshot.scope?.sessionId || "").trim()) errors.push("session_identity_mismatch");
  if (!Array.isArray(snapshot.turns)) errors.push("invalid_turns");
  if (!Array.isArray(snapshot.messages)) errors.push("invalid_messages");
  return { valid: errors.length === 0, errors };
}

