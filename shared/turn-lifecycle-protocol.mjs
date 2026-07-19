/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TURN_LIFECYCLE_PROTOCOL_VERSION = 1;
export const TURN_LIFECYCLE_WIRE_EVENT = "turn_lifecycle";

export const TURN_COMMAND = Object.freeze({
  SEND: "turn.send",
  RESEND: "turn.resend",
  CONTINUE: "turn.continue",
  STOP: "turn.stop",
  FINALIZE: "turn.finalize",
  SNAPSHOT_GET: "turn.snapshot.get",
});

export const TURN_PHASE = Object.freeze({
  ACTION: "action",
  PROCESSING: "processing",
  COMPLETION: "completion",
  STOP: "stop",
});

export const TURN_EVENT = Object.freeze({
  ACTION_ACCEPTED: "turn.action_accepted",
  PROCESSING_STARTED: "turn.processing_started",
  PROCESSING_COMPLETED: "turn.processing_completed",
  STOP_ACCEPTED: "turn.stop_accepted",
  STOP_PROCESSING_COMPLETED: "turn.stop_processing_completed",
  COMPLETED: "turn.completed",
  STOP_COMPLETED: "turn.stop_completed",
  FAILED: "turn.failed",
  SNAPSHOT: "turn.snapshot",
});

export const TURN_STATE = Object.freeze({
  ACTION_REQUESTING: "action_requesting",
  PROCESSING: "processing",
  COMPLETION_REQUESTING: "completion_requesting",
  COMPLETED: "completed",
  STOPPING: "stopping",
  STOP_COMPLETED: "stop_completed",
  ACTION_FAILED: "action_failed",
  PROCESSING_FAILED: "processing_failed",
  COMPLETION_FAILED: "completion_failed",
  STOP_FAILED: "stop_failed",
});

const STOPPABLE_STATES = new Set([TURN_STATE.PROCESSING]);
const EVENT_VALUES = new Set(Object.values(TURN_EVENT));

const clean = (value) => String(value || "").trim();

export function deriveAuthoritativeTurnCapabilities(turn = {}) {
  const state = clean(turn.state);
  const executionState = clean(turn.executionState).toLowerCase();
  return Object.freeze({
    actionLocked: Boolean(state) && ![
      TURN_STATE.COMPLETED,
      TURN_STATE.STOP_COMPLETED,
      TURN_STATE.ACTION_FAILED,
      TURN_STATE.PROCESSING_FAILED,
      TURN_STATE.COMPLETION_FAILED,
      TURN_STATE.STOP_FAILED,
    ].includes(state),
    canStop: STOPPABLE_STATES.has(state) && executionState === "sending",
  });
}

function snapshotTurn(turn = {}) {
  return {
    turnScopeId: clean(turn.turnScopeId),
    dialogProcessId: clean(turn.dialogProcessId),
    commandId: clean(turn.commandId),
    action: clean(turn.action),
    state: clean(turn.state),
    phase: clean(turn.phase),
    executionState: clean(turn.executionState).toLowerCase(),
    revision: Number(turn.revision || 0),
    sequence: Number(turn.sequence || 0),
    summaryVersion: Number(turn.summaryVersion || 0),
    failure: turn.failure && typeof turn.failure === "object" ? turn.failure : null,
    finalizeIntent: turn.finalizeIntent && typeof turn.finalizeIntent === "object" ? turn.finalizeIntent : null,
    capabilities: deriveAuthoritativeTurnCapabilities(turn),
    createdAt: clean(turn.createdAt),
    updatedAt: clean(turn.updatedAt),
  };
}

/** Build a Session-scoped authoritative snapshot; unlike event envelopes it may contain no active Turn. */
export function createTurnLifecycleSnapshot({
  commandId = "", userId = "", sessionId, sequence = 0, activeTurnScopeId = "",
  activeTurn = null, recentTerminalTurns = [], unchanged = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: TURN_EVENT.SNAPSHOT,
    commandId: clean(commandId),
    userId: clean(userId),
    sessionId: clean(sessionId),
    sequence: Number(sequence || 0),
    activeTurnScopeId: clean(activeTurnScopeId),
    activeTurn: activeTurn ? snapshotTurn(activeTurn) : null,
    recentTerminalTurns: (Array.isArray(recentTerminalTurns) ? recentTerminalTurns : []).map(snapshotTurn),
    unchanged: unchanged === true,
    generatedAt: clean(generatedAt),
  };
}

export function validateTurnLifecycleSnapshot(snapshot = {}) {
  const errors = [];
  if (Number(snapshot.protocolVersion) !== TURN_LIFECYCLE_PROTOCOL_VERSION) errors.push("unsupported_protocol_version");
  if (clean(snapshot.eventType) !== TURN_EVENT.SNAPSHOT) errors.push("invalid_snapshot_event_type");
  if (!clean(snapshot.commandId)) errors.push("missing_command_id");
  if (!clean(snapshot.sessionId)) errors.push("missing_session_id");
  if (!Number.isInteger(Number(snapshot.sequence)) || Number(snapshot.sequence) < 0) errors.push("invalid_sequence");
  const turns = [snapshot.activeTurn, ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : [])].filter(Boolean);
  for (const turn of turns) {
    if (!clean(turn.turnScopeId)) errors.push("missing_turn_scope_id");
    if (!Number.isInteger(Number(turn.revision)) || Number(turn.revision) < 1) errors.push("invalid_turn_revision");
    if (!Number.isInteger(Number(turn.sequence)) || Number(turn.sequence) < 1) errors.push("invalid_turn_sequence");
  }
  if (snapshot.activeTurn && clean(snapshot.activeTurnScopeId) !== clean(snapshot.activeTurn.turnScopeId)) errors.push("active_turn_identity_mismatch");
  return { valid: errors.length === 0, errors };
}

export function createTurnLifecycleEnvelope({
  eventType,
  eventId,
  commandId,
  causationId = "",
  correlationId = "",
  userId = "",
  sessionId,
  turnScopeId,
  dialogProcessId = "",
  revision,
  sequence,
  phase,
  state,
  occurredAt = new Date().toISOString(),
  capabilities,
  failure = null,
  payload = {},
} = {}) {
  const envelope = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: clean(eventType),
    eventId: clean(eventId),
    commandId: clean(commandId),
    causationId: clean(causationId),
    correlationId: clean(correlationId),
    userId: clean(userId),
    sessionId: clean(sessionId),
    turnScopeId: clean(turnScopeId),
    dialogProcessId: clean(dialogProcessId),
    revision: Number(revision || 0),
    sequence: Number(sequence || 0),
    phase: clean(phase),
    state: clean(state),
    occurredAt: clean(occurredAt),
    capabilities: capabilities && typeof capabilities === "object" ? capabilities : undefined,
    failure: failure && typeof failure === "object" ? failure : undefined,
    payload: payload && typeof payload === "object" ? payload : {},
  };
  return envelope;
}

export function validateTurnLifecycleEnvelope(envelope = {}) {
  const errors = [];
  if (Number(envelope.protocolVersion) !== TURN_LIFECYCLE_PROTOCOL_VERSION) errors.push("unsupported_protocol_version");
  if (!EVENT_VALUES.has(clean(envelope.eventType))) errors.push("invalid_event_type");
  if (!clean(envelope.eventId)) errors.push("missing_event_id");
  if (!clean(envelope.sessionId)) errors.push("missing_session_id");
  if (!clean(envelope.turnScopeId)) errors.push("missing_turn_scope_id");
  if (!Number.isInteger(Number(envelope.revision)) || Number(envelope.revision) < 1) errors.push("invalid_revision");
  if (!Number.isInteger(Number(envelope.sequence)) || Number(envelope.sequence) < 1) errors.push("invalid_sequence");
  return { valid: errors.length === 0, errors };
}

export function isAuthoritativeTurnLifecycleEnvelope(envelope = {}) {
  return validateTurnLifecycleEnvelope(envelope).valid;
}
