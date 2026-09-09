/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeTurnScopeId } from "../identity/turn-scope-identity.js";
import { snapshotTurn } from "./turn-projection.js";
import { TURN_STATE, TURN_TERMINAL_STATES } from "./turn-state.js";
import {
  collectPositiveIntegerErrors,
  collectRequiredFieldErrors,
} from "./turn-field-assertions.js";
import { text as clean } from "../normalize.js";

export const TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION = 2;
export const TURN_TERMINAL_RESOLVED_EVENT = "turn.terminal_resolved";

const TERMINAL_STATE_VALUES = new Set(TURN_TERMINAL_STATES);
const FAILED_TERMINAL_STATES = new Set([
  TURN_STATE.ACTION_FAILED,
  TURN_STATE.PROCESSING_FAILED,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOP_FAILED,
]);

export function createTurnTerminalResolution({
  commandId = "",
  sessionId = "",
  turnScopeId = "",
  resolved = false,
  retryable = false,
  reason = "",
  retryAfterMs = 0,
  turn = null,
  materialization = null,
  aggregateVersion = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedTurn = turn
    ? {
        ...turn,
        terminalStatus: turn.terminalStatus || materialization?.terminalStatus || null,
      }
    : null;
  return {
    protocolVersion: TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION,
    eventType: TURN_TERMINAL_RESOLVED_EVENT,
    commandId: clean(commandId),
    sessionId: clean(sessionId),
    turnScopeId: canonicalizeTurnScopeId(turnScopeId),
    resolved: resolved === true,
    retryable: retryable === true,
    reason: clean(reason),
    retryAfterMs: Math.max(0, Number(retryAfterMs || 0)),
    aggregateVersion: aggregateVersion == null ? null : Number(aggregateVersion),
    turn: resolvedTurn
      ? { ...snapshotTurn(resolvedTurn), sessionId: clean(resolvedTurn.sessionId || sessionId) }
      : null,
    materialization:
      materialization && typeof materialization === "object" ? materialization : null,
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
  if (response.resolved === true) {
    const turn = response.turn || {};
    const materialization = response.materialization || {};
    const terminalStatus = turn.terminalStatus || materialization.terminalStatus;
    if (clean(turn.sessionId) !== clean(response.sessionId))
      errors.push("terminal_session_identity_mismatch");
    if (clean(turn.turnScopeId) !== clean(response.turnScopeId))
      errors.push("terminal_turn_identity_mismatch");
    if (!TERMINAL_STATE_VALUES.has(clean(turn.state))) errors.push("invalid_terminal_state");
    errors.push(...collectPositiveIntegerErrors(turn.revision, "invalid_turn_revision"));
    errors.push(...collectPositiveIntegerErrors(turn.sequence, "invalid_turn_sequence"));
    if (!terminalStatus || typeof terminalStatus !== "object")
      errors.push("missing_terminal_status");
    if (!Number.isInteger(response.aggregateVersion) || response.aggregateVersion < 0)
      errors.push("invalid_aggregate_version");
    if (
      FAILED_TERMINAL_STATES.has(clean(turn.state)) &&
      (!turn.failure || typeof turn.failure !== "object")
    )
      errors.push("missing_terminal_failure");
  } else if (!clean(response.reason)) errors.push("missing_unresolved_reason");
  return { valid: errors.length === 0, errors };
}
