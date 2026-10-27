/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isObjectLike } from "@noobot/shared/value";
import { requireCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { snapshotTurn } from "./turn-projection.js";
import { TURN_FAILED_STATES, TURN_TERMINAL_STATES } from "./turn-state.js";
import {
  collectPositiveIntegerErrors,
  collectRequiredFieldErrors,
} from "./turn-field-assertions.js";

export const TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION = 2;
export const TURN_TERMINAL_RESOLVED_EVENT = "turn.terminal_resolved";

const TERMINAL_STATE_VALUES = new Set(TURN_TERMINAL_STATES);
const FAILED_TERMINAL_STATES = new Set(TURN_FAILED_STATES);

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function createTurnTerminalResolution({
  commandId = "",
  sessionId = "",
  turnScopeId = "",
  resolved = false,
  retryable = false,
  reason = "",
  retryAfterMs,
  turn = null,
  aggregateVersion = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (retryable === true ? !isPositiveInteger(retryAfterMs) : retryAfterMs !== undefined) {
    throw new TypeError(
      "terminal resolution retryAfterMs must be a positive integer only when retryable",
    );
  }
  return {
    protocolVersion: TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION,
    eventType: TURN_TERMINAL_RESOLVED_EVENT,
    commandId: clean(commandId),
    sessionId: clean(sessionId),
    turnScopeId: requireCanonicalTurnScopeId(turnScopeId),
    resolved: resolved === true,
    retryable: retryable === true,
    reason: clean(reason),
    retryAfterMs: retryable === true ? retryAfterMs : 0,
    aggregateVersion: aggregateVersion == null ? null : Number(aggregateVersion),
    turn: turn ? snapshotTurn(turn) : null,
    generatedAt: clean(generatedAt),
  };
}

export function validateTurnTerminalResolution(response = {}) {
  const errors = [];
  if (Number(response.protocolVersion) !== TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION)
    errors.push("unsupported_terminal_resolution_version");
  if (clean(response.eventType) !== TURN_TERMINAL_RESOLVED_EVENT)
    errors.push("invalid_terminal_resolution_event_type");
  errors.push(...collectRequiredFieldErrors(response.commandId, "missing_command_id"));
  errors.push(...collectRequiredFieldErrors(response.sessionId, "missing_session_id"));
  errors.push(...collectRequiredFieldErrors(response.turnScopeId, "missing_turn_scope_id"));
  if (
    response.retryable === true
      ? !isPositiveInteger(response.retryAfterMs)
      : response.retryAfterMs !== 0
  )
    errors.push("invalid_retry_after_ms");
  if (response.resolved === true) {
    const turn = response.turn || {};
    const terminalStatus = turn.terminalStatus;
    if (clean(turn.sessionId) !== clean(response.sessionId))
      errors.push("terminal_session_identity_mismatch");
    if (clean(turn.turnScopeId) !== clean(response.turnScopeId))
      errors.push("terminal_turn_identity_mismatch");
    if (!TERMINAL_STATE_VALUES.has(clean(turn.state))) errors.push("invalid_terminal_state");
    errors.push(...collectPositiveIntegerErrors(turn.revision, "invalid_turn_revision"));
    errors.push(...collectPositiveIntegerErrors(turn.sequence, "invalid_turn_sequence"));
    if (!isObjectLike(terminalStatus)) errors.push("missing_terminal_status");
    if (!Number.isInteger(response.aggregateVersion) || response.aggregateVersion < 0)
      errors.push("invalid_aggregate_version");
    if (FAILED_TERMINAL_STATES.has(clean(turn.state)) && !isObjectLike(turn.failure))
      errors.push("missing_terminal_failure");
  } else if (!clean(response.reason)) errors.push("missing_unresolved_reason");
  return { valid: errors.length === 0, errors };
}
