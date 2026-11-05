/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isObjectLike, isCanonicalText } from "@noobot/shared/value";
import { requireCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { snapshotTurn } from "./turn-projection.js";
import { collectTurnRecordErrors } from "./turn-record.js";
import { projectTurnTerminalRuntimeEvent } from "../runtime-event.js";
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

export function requireTurnTerminalResolutionIdentity({ commandId, sessionId, turnScopeId }) {
  if (!isCanonicalText(commandId) || !isCanonicalText(sessionId)) {
    throw new TypeError("terminal resolution requires commandId and sessionId as canonical text");
  }
  return { commandId, sessionId, turnScopeId: requireCanonicalTurnScopeId(turnScopeId) };
}

export function createTurnTerminalResolution({
  commandId,
  sessionId,
  turnScopeId,
  resolved = false,
  retryable = false,
  reason = "",
  retryAfterMs,
  turn = null,
  aggregateVersion = null,
  generatedAt,
}) {
  if (retryable === true ? !isPositiveInteger(retryAfterMs) : retryAfterMs !== undefined) {
    throw new TypeError(
      "terminal resolution retryAfterMs must be a positive integer only when retryable",
    );
  }
  const identity = requireTurnTerminalResolutionIdentity({ commandId, sessionId, turnScopeId });
  const response = {
    protocolVersion: TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION,
    eventType: TURN_TERMINAL_RESOLVED_EVENT,
    ...identity,
    resolved,
    retryable,
    reason,
    retryAfterMs: retryable === true ? retryAfterMs : 0,
    aggregateVersion,
    turn,
    generatedAt,
  };
  const validation = validateTurnTerminalResolution(response);
  if (!validation.valid) throw new TypeError(validation.errors.join(", "));
  return { ...response, turn: turn === null ? null : snapshotTurn(turn) };
}

function collectResolvedTurnErrors(response) {
  const { turn } = response;
  const recordErrors = collectTurnRecordErrors(turn);
  if (recordErrors.includes("invalid_turn_record")) return recordErrors;
  const errors = [...recordErrors];
  try {
    projectTurnTerminalRuntimeEvent(response);
  } catch (error) {
    errors.push(error.message);
  }
  if (clean(turn.sessionId) !== clean(response.sessionId))
    errors.push("terminal_session_identity_mismatch");
  if (clean(turn.turnScopeId) !== clean(response.turnScopeId))
    errors.push("terminal_turn_identity_mismatch");
  if (!TERMINAL_STATE_VALUES.has(clean(turn.state))) errors.push("invalid_terminal_state");
  errors.push(...collectPositiveIntegerErrors(turn.revision, "invalid_turn_revision"));
  errors.push(...collectPositiveIntegerErrors(turn.sequence, "invalid_turn_sequence"));
  if (!isObjectLike(turn.terminalStatus)) errors.push("missing_terminal_status");
  if (!Number.isInteger(response.aggregateVersion) || response.aggregateVersion < 0)
    errors.push("invalid_aggregate_version");
  if (FAILED_TERMINAL_STATES.has(clean(turn.state)) && !isObjectLike(turn.failure))
    errors.push("missing_terminal_failure");
  return errors;
}

export function validateTurnTerminalResolution(response) {
  if (!isObjectLike(response)) return { valid: false, errors: ["invalid_terminal_resolution"] };
  const errors = [];
  for (const field of ["commandId", "sessionId", "turnScopeId", "generatedAt"]) {
    if (!isCanonicalText(response[field])) errors.push(`invalid_${field}`);
  }
  if (typeof response.resolved !== "boolean") errors.push("invalid_resolved");
  if (typeof response.retryable !== "boolean") errors.push("invalid_retryable");
  if (response.reason !== "" && !isCanonicalText(response.reason)) errors.push("invalid_reason");
  if (response.protocolVersion !== TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION)
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
  if (response.resolved === true) errors.push(...collectResolvedTurnErrors(response));
  else if (!clean(response.reason)) errors.push("missing_unresolved_reason");
  return { valid: errors.length === 0, errors };
}
