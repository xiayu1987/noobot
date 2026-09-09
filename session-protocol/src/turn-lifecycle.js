/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXECUTION_KIND, normalizeExecutionIdentity } from "./execution-lifecycle.js";
import { canonicalizeTurnScopeId, isCanonicalTurnScopeId } from "./identity/turn-scope-identity.js";
import { deriveAuthoritativeTurnCapabilities } from "./lifecycle/turn-capability.js";
import {
  collectPositiveIntegerErrors,
  collectRequiredFieldErrors,
  collectTurnMaterializationErrors,
  collectTurnScopeIdErrors,
} from "./lifecycle/turn-field-assertions.js";
import { normalizeTurnContinuationSource } from "./lifecycle/turn-continuation.js";
import { TURN_COMMAND, TURN_EVENT, TURN_EVENT_VALUES } from "./lifecycle/turn-event.js";
import { TURN_EVENT_STATE, TURN_FAILED_PHASE_STATE } from "./lifecycle/turn-transition-policy.js";
import { TURN_PHASE, TURN_STATE } from "./lifecycle/turn-state.js";
import { snapshotReplacedTurn, snapshotTurn } from "./lifecycle/turn-projection.js";

export {
  deriveAuthoritativeTurnCapabilities,
  normalizeTurnContinuationSource,
  TURN_COMMAND,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
};

export {
  createTurnTerminalResolution,
  TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION,
  TURN_TERMINAL_RESOLVED_EVENT,
  validateTurnTerminalResolution,
} from "./lifecycle/turn-terminal-resolution.js";

export const TURN_LIFECYCLE_PROTOCOL_VERSION = 1;
export const TURN_LIFECYCLE_WIRE_EVENT = "turn_lifecycle";
export const TURN_SNAPSHOT_WIRE_EVENT = "turn_snapshot";
export const TURN_LIFECYCLE_TRANSPORT_PROTOCOL_VERSION = 3;
export const TURN_LIFECYCLE_RECEIPT_PROTOCOL_VERSION = 1;
export const TURN_LIFECYCLE_RECEIPT_ACTION = "turn.lifecycle.received";

const EVENT_VALUES = new Set(TURN_EVENT_VALUES);
const EVENT_STATE = TURN_EVENT_STATE;

const EVENT_PHASE = Object.freeze({
  [TURN_EVENT.ACTION_ACCEPTED]: TURN_PHASE.ACTION,
  [TURN_EVENT.PROCESSING_STARTED]: TURN_PHASE.PROCESSING,
  [TURN_EVENT.PROCESSING_COMPLETED]: TURN_PHASE.COMPLETION,
  [TURN_EVENT.STOP_ACCEPTED]: TURN_PHASE.STOP,
  [TURN_EVENT.STOP_PROCESSING_COMPLETED]: TURN_PHASE.STOP,
  [TURN_EVENT.COMPLETED]: TURN_PHASE.COMPLETION,
  [TURN_EVENT.STOP_COMPLETED]: TURN_PHASE.STOP,
});

const FAILED_PHASE_STATE = TURN_FAILED_PHASE_STATE;

const clean = (value) => String(value || "").trim();

export function createTurnLifecycleReceipt({
  eventId = "",
  sessionId = "",
  turnScopeId = "",
} = {}) {
  return {
    action: TURN_LIFECYCLE_RECEIPT_ACTION,
    protocolVersion: TURN_LIFECYCLE_RECEIPT_PROTOCOL_VERSION,
    eventId: clean(eventId),
    sessionId: clean(sessionId),
    turnScopeId: canonicalizeTurnScopeId(turnScopeId),
  };
}

export function validateTurnLifecycleReceipt(receipt = {}) {
  const errors = [];
  if (clean(receipt.action) !== TURN_LIFECYCLE_RECEIPT_ACTION) errors.push("invalid_action");
  if (Number(receipt.protocolVersion) !== TURN_LIFECYCLE_RECEIPT_PROTOCOL_VERSION) {
    errors.push("unsupported_protocol_version");
  }
  if (!clean(receipt.eventId)) errors.push("missing_event_id");
  if (!clean(receipt.sessionId)) errors.push("missing_session_id");
  errors.push(...collectTurnScopeIdErrors(receipt.turnScopeId));
  return { valid: errors.length === 0, errors };
}

export function validateSessionProvisionIntent(input = {}) {
  if (input.createSessionIfAbsent === undefined || input.createSessionIfAbsent === false) {
    return { valid: true, requested: false, errors: [] };
  }
  const valid =
    input.createSessionIfAbsent === true &&
    clean(input.eventType) === TURN_EVENT.ACTION_ACCEPTED &&
    clean(input.action) === "send" &&
    Number(input.expectedRevision ?? 0) === 0;
  return {
    valid,
    requested: input.createSessionIfAbsent === true,
    errors: valid ? [] : ["invalid_session_provision_intent"],
  };
}

export function createTurnLifecycleSnapshot({
  commandId = "",
  userId = "",
  sessionId,
  sequence = 0,
  activeTurnScopeId = "",
  activeTurn = null,
  recentTerminalTurns = [],
  replacedTurns = [],
  unchanged = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: TURN_EVENT.SNAPSHOT,
    commandId: clean(commandId),
    userId: clean(userId),
    sessionId: clean(sessionId),
    sequence: Number(sequence || 0),
    activeTurnScopeId: canonicalizeTurnScopeId(activeTurnScopeId),
    activeTurn: activeTurn ? snapshotTurn(activeTurn) : null,
    recentTerminalTurns: (Array.isArray(recentTerminalTurns) ? recentTerminalTurns : []).map(
      snapshotTurn,
    ),
    replacedTurns: (Array.isArray(replacedTurns) ? replacedTurns : []).map(snapshotReplacedTurn),
    unchanged: unchanged === true,
    generatedAt: clean(generatedAt),
  };
}

export function validateTurnLifecycleSnapshot(snapshot = {}) {
  const errors = [];
  if (Number(snapshot.protocolVersion) !== TURN_LIFECYCLE_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (clean(snapshot.eventType) !== TURN_EVENT.SNAPSHOT) errors.push("invalid_snapshot_event_type");
  if (!clean(snapshot.commandId)) errors.push("missing_command_id");
  if (!clean(snapshot.sessionId)) errors.push("missing_session_id");
  if (!Number.isInteger(Number(snapshot.sequence)) || Number(snapshot.sequence) < 0)
    errors.push("invalid_sequence");
  const turns = [
    snapshot.activeTurn,
    ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : []),
  ].filter(Boolean);
  for (const turn of turns) {
    errors.push(...collectTurnMaterializationErrors(turn));
    if (
      Number.isInteger(Number(turn.sequence)) &&
      Number(turn.sequence) >= 1 &&
      Number(turn.sequence) > Number(snapshot.sequence)
    )
      errors.push("turn_sequence_exceeds_snapshot");
  }
  if (!Array.isArray(snapshot.replacedTurns)) errors.push("missing_replaced_turns");
  const replacementScopes = new Set();
  for (const replacement of Array.isArray(snapshot.replacedTurns) ? snapshot.replacedTurns : []) {
    const turnScopeId = canonicalizeTurnScopeId(replacement?.turnScopeId);
    const replacementTurnScopeId = canonicalizeTurnScopeId(replacement?.replacementTurnScopeId);
    const replacedTurnScopeIds = Array.isArray(replacement?.replacedTurnScopeIds)
      ? replacement.replacedTurnScopeIds.map(canonicalizeTurnScopeId).filter(Boolean)
      : [];
    if (!turnScopeId) errors.push("missing_replaced_turn_scope_id");
    else if (!isCanonicalTurnScopeId(replacement.turnScopeId))
      errors.push("non_canonical_replaced_turn_scope_id");
    if (replacementScopes.has(turnScopeId)) errors.push("duplicate_replaced_turn_scope_id");
    replacementScopes.add(turnScopeId);
    if (!clean(replacement?.replacementDialogProcessId))
      errors.push("missing_replacement_dialog_process_id");
    if (!clean(replacement?.requestHash)) errors.push("missing_replacement_request_hash");
    if (!replacementTurnScopeId) errors.push("missing_replacement_turn_scope_id");
    else if (!isCanonicalTurnScopeId(replacement.replacementTurnScopeId))
      errors.push("non_canonical_replacement_turn_scope_id");
    if (!clean(replacement?.replacementUserMessageId))
      errors.push("missing_replacement_user_message_id");
    if (!clean(replacement?.commandId)) errors.push("missing_replacement_command_id");
    if (
      !Number.isInteger(Number(replacement?.committedAggregateVersion)) ||
      Number(replacement.committedAggregateVersion) < 1
    )
      errors.push("invalid_replacement_committed_version");
    if (!replacedTurnScopeIds.length || !replacedTurnScopeIds.includes(turnScopeId))
      errors.push("invalid_replaced_turn_scope_ids");
    if (replacedTurnScopeIds.includes(replacementTurnScopeId))
      errors.push("replacement_scope_reuses_replaced_scope");
    if (
      !Number.isInteger(Number(replacement?.sequence)) ||
      Number(replacement.sequence) < 1 ||
      Number(replacement.sequence) > Number(snapshot.sequence)
    )
      errors.push("invalid_replacement_sequence");
    if (!clean(replacement?.committedAt)) errors.push("missing_replacement_committed_at");
  }
  const materializedTurnScopes = new Set(
    turns.map((turn) => canonicalizeTurnScopeId(turn?.turnScopeId)).filter(Boolean),
  );
  if ([...replacementScopes].some((turnScopeId) => materializedTurnScopes.has(turnScopeId))) {
    errors.push("replaced_turn_still_materialized");
  }
  if (
    snapshot.activeTurn &&
    canonicalizeTurnScopeId(snapshot.activeTurnScopeId) !==
      canonicalizeTurnScopeId(snapshot.activeTurn.turnScopeId)
  )
    errors.push("active_turn_identity_mismatch");
  if (
    snapshot.activeTurn &&
    !clean(snapshot.activeTurn.startedAt) &&
    !clean(snapshot.activeTurn.thinkingStartedAt)
  ) {
    errors.push("missing_active_turn_started_at");
  }
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
  parentSessionId = "",
  turnScopeId,
  messageId = "",
  presentationMessageId = "",
  dialogProcessId = "",
  revision,
  sequence,
  phase,
  state,
  action = "",
  executionState = "",
  summaryVersion = 0,
  completionCommitId = "",
  updatedAt = "",
  startedAt = "",
  finishedAt = "",
  occurredAt = new Date().toISOString(),
  capabilities,
  failure = null,
  payload = {},
  executionId = "",
  executionKind = EXECUTION_KIND.AGENT,
  parentExecutionId = "",
  rootExecutionId = "",
  origin = {},
  stage = "",
  continuationSource = null,
  continuedByTurnScopeId = "",
} = {}) {
  const executionIdentity = normalizeExecutionIdentity({
    executionId,
    executionKind,
    parentExecutionId,
    rootExecutionId,
    origin,
    stage,
    sessionId,
    parentSessionId,
    turnScopeId,
    dialogProcessId,
  });
  const envelope = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: clean(eventType),
    eventId: clean(eventId),
    commandId: clean(commandId),
    causationId: clean(causationId),
    correlationId: clean(correlationId),
    userId: clean(userId),
    sessionId: clean(sessionId),
    parentSessionId: clean(parentSessionId),
    turnScopeId: canonicalizeTurnScopeId(turnScopeId),
    messageId: clean(messageId),
    presentationMessageId: clean(presentationMessageId),
    dialogProcessId: clean(dialogProcessId),
    revision: Number(revision || 0),
    sequence: Number(sequence || 0),
    phase: clean(phase),
    state: clean(state),
    action: clean(action),
    executionState: clean(executionState).toLowerCase(),
    summaryVersion: Number(summaryVersion || 0),
    completionCommitId: clean(completionCommitId),
    updatedAt: clean(updatedAt),
    startedAt: clean(startedAt),
    finishedAt: clean(finishedAt),
    occurredAt: clean(occurredAt),
    capabilities: capabilities && typeof capabilities === "object" ? capabilities : undefined,
    failure: failure && typeof failure === "object" ? failure : undefined,
    payload: payload && typeof payload === "object" ? payload : {},
    continuationSource: normalizeTurnContinuationSource(continuationSource) || undefined,
    continuedByTurnScopeId: canonicalizeTurnScopeId(continuedByTurnScopeId),
    ...executionIdentity,
  };
  return envelope;
}

export function validateTurnLifecycleEnvelope(envelope = {}) {
  const errors = [];
  if (Number(envelope.protocolVersion) !== TURN_LIFECYCLE_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (!EVENT_VALUES.has(clean(envelope.eventType))) errors.push("invalid_event_type");
  if (!clean(envelope.eventId)) errors.push("missing_event_id");
  if (!clean(envelope.sessionId)) errors.push("missing_session_id");
  errors.push(...collectTurnScopeIdErrors(envelope.turnScopeId));
  errors.push(...collectRequiredFieldErrors(envelope.messageId, "missing_message_id"));
  errors.push(
    ...collectRequiredFieldErrors(
      envelope.presentationMessageId,
      "missing_presentation_message_id",
    ),
  );
  errors.push(...collectPositiveIntegerErrors(envelope.revision, "invalid_revision"));
  errors.push(...collectPositiveIntegerErrors(envelope.sequence, "invalid_sequence"));
  const eventType = clean(envelope.eventType);
  const phase = clean(envelope.phase || envelope.failure?.phase);
  const expectedState =
    eventType === TURN_EVENT.FAILED ? FAILED_PHASE_STATE[phase] : EVENT_STATE[eventType];
  const expectedPhase = eventType === TURN_EVENT.FAILED ? phase : EVENT_PHASE[eventType];
  if (!expectedPhase || phase !== expectedPhase) errors.push("event_phase_mismatch");
  if (!expectedState || clean(envelope.state) !== expectedState)
    errors.push("event_state_mismatch");
  if (envelope.persistenceScope !== undefined) errors.push("unsupported_persistence_scope");
  if (
    clean(envelope.eventType) === TURN_EVENT.ACTION_ACCEPTED &&
    clean(envelope.action) === "continue"
  ) {
    if (!normalizeTurnContinuationSource(envelope.continuationSource))
      errors.push("missing_continuation_source");
  } else if (
    clean(envelope.eventType) === TURN_EVENT.ACTION_ACCEPTED &&
    envelope.continuationSource !== undefined
  ) {
    errors.push("unexpected_continuation_source");
  }
  if ([TURN_EVENT.COMPLETED, TURN_EVENT.STOP_COMPLETED].includes(clean(envelope.eventType))) {
    if (!clean(envelope.completionCommitId)) errors.push("missing_completion_commit_id");
    if (!Number.isInteger(Number(envelope.summaryVersion)) || Number(envelope.summaryVersion) < 1)
      errors.push("invalid_completion_summary_version");
  }
  return { valid: errors.length === 0, errors };
}

export function isAuthoritativeTurnLifecycleEnvelope(envelope = {}) {
  return validateTurnLifecycleEnvelope(envelope).valid;
}

export function validateSessionEvent(event = {}) {
  const eventType = clean(event?.eventType || event?.identity?.eventType);
  if (!EVENT_VALUES.has(eventType)) {
    return { valid: false, recognized: false, errors: ["unsupported_session_event"] };
  }
  return { ...validateTurnLifecycleEnvelope(event), recognized: true };
}
