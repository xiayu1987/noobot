/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isCanonicalText, isObjectLike, isPlainObject } from "@noobot/shared/value";
import { authorityOutboxSequenceKey } from "@noobot/event-protocol/outbox";
import { SESSION_SEQUENCE_DOMAIN } from "@noobot/event-protocol/turn-snapshot";
import { normalizeExecutionIdentity } from "./execution-lifecycle.js";
import { projectTurnLifecycleRuntimeEvent } from "./runtime-event.js";
import {
  isCanonicalTurnScopeId,
  requireCanonicalTurnScopeId,
  requireOptionalCanonicalTurnScopeId,
} from "./identity/turn-scope-identity.js";
import { deriveAuthoritativeTurnCapabilities } from "./lifecycle/turn-capability.js";
import { collectTurnFailureErrors, collectTurnRecordErrors } from "./lifecycle/turn-record.js";
import {
  collectPositiveIntegerErrors,
  collectRequiredFieldErrors,
  collectDialogProcessIdErrors,
  collectParentSessionIdErrors,
  collectTurnScopeIdErrors,
} from "./lifecycle/turn-field-assertions.js";
import { normalizeTurnContinuationSource } from "./lifecycle/turn-continuation.js";
import {
  isTurnCommitContinuation,
  TURN_COMMIT_ACTION,
  normalizeTurnCommitAction,
} from "./lifecycle/turn-commit-action.js";
import {
  isCompletionCommitTurnEvent,
  isSettlingTurnEvent,
  isTerminalTurnEvent,
  TURN_COMMAND,
  TURN_EVENT,
  TURN_EVENT_VALUES,
  TURN_TERMINAL_EVENTS,
} from "./lifecycle/turn-event.js";
import {
  TURN_EVENT_PHASE,
  TURN_EVENT_STATE,
  TURN_FAILED_PHASE_STATE,
} from "./lifecycle/turn-transition-policy.js";
import { isTerminalTurnState, TURN_PHASE, TURN_STATE } from "./lifecycle/turn-state.js";
import { isSessionCaller } from "@noobot/shared/session-caller";
import { collectTurnReplacementTombstoneErrors } from "./lifecycle/turn-replacement.js";
import {
  collectSnapshotTurnFieldErrors,
  snapshotReplacedTurn,
  snapshotTurn,
} from "./lifecycle/turn-projection.js";
import {
  isActionableTurnRecovery,
  isTurnRecoveryAction,
  TURN_ORPHAN_RECOVERY,
  TURN_RECOVERY_ACTION,
} from "./lifecycle/turn-recovery.js";

export function sessionLifecycleSequenceKey(sessionId) {
  return authorityOutboxSequenceKey(SESSION_SEQUENCE_DOMAIN, sessionId);
}

export async function readSessionEventSequenceFloor({
  sessionId,
  domain,
  scopeId,
  readLifecycleHead,
  readStoredFloor,
}) {
  const key = authorityOutboxSequenceKey(domain, scopeId);
  if (key === sessionLifecycleSequenceKey(sessionId))
    return requireTurnLifecycleHeader(await readLifecycleHead()).sequence;
  return readStoredFloor(key);
}

export {
  deriveAuthoritativeTurnCapabilities,
  isSettlingTurnEvent,
  isTerminalTurnEvent,
  isTerminalTurnState,
  normalizeTurnContinuationSource,
  TURN_COMMAND,
  TURN_EVENT,
  TURN_ORPHAN_RECOVERY,
  TURN_PHASE,
  TURN_RECOVERY_ACTION,
  TURN_STATE,
  TURN_TERMINAL_EVENTS,
};

export {
  createTurnTerminalResolution,
  requireTurnTerminalResolutionIdentity,
  TURN_TERMINAL_RESOLUTION_PROTOCOL_VERSION,
  TURN_TERMINAL_RESOLVED_EVENT,
  validateTurnTerminalResolution,
} from "./lifecycle/turn-terminal-resolution.js";

export {
  requireTurnExecutionObservation,
  requireTurnRecoveryCommitResult,
} from "./lifecycle/turn-recovery.js";

export const TURN_LIFECYCLE_PROTOCOL_VERSION = 1;
export const TURN_LIFECYCLE_WIRE_EVENT = "turn_lifecycle";
export const TURN_SNAPSHOT_WIRE_EVENT = "turn_snapshot";
export const TURN_LIFECYCLE_TRANSPORT_PROTOCOL_VERSION = 3;
export const TURN_LIFECYCLE_RECEIPT_PROTOCOL_VERSION = 1;
export const TURN_LIFECYCLE_RECEIPT_ACTION = "turn.lifecycle.received";
export const TURN_SNAPSHOT_TERMINAL_LIMIT = Object.freeze({ DEFAULT: 10, MAX: 100 });

export function requireTurnLifecycleHeader(header) {
  if (
    !isPlainObject(header) ||
    !Number.isSafeInteger(header.sequence) ||
    header.sequence < 0 ||
    (header.activeTurnScopeId !== "" && !isCanonicalText(header.activeTurnScopeId))
  )
    throw Object.assign(new TypeError("Invalid indexed lifecycle header"), {
      code: "TURN_LIFECYCLE_RECORD_INVALID",
    });
  return { sequence: header.sequence, activeTurnScopeId: header.activeTurnScopeId };
}

export function isTurnSnapshotTerminalLimit(value) {
  return Number.isInteger(value) && value >= 0 && value <= TURN_SNAPSHOT_TERMINAL_LIMIT.MAX;
}

export function requireTurnLifecycleSourceSelection(options = {}) {
  if (
    !isPlainObject(options) ||
    Object.keys(options).some((key) => key !== "terminalLimit" && key !== "reconcileTurnScopeIds")
  )
    throw new TypeError("Invalid lifecycle source selection");
  const { terminalLimit = TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT, reconcileTurnScopeIds = [] } =
    options;
  if (
    !isTurnSnapshotTerminalLimit(terminalLimit) ||
    !Array.isArray(reconcileTurnScopeIds) ||
    reconcileTurnScopeIds.length > TURN_SNAPSHOT_TERMINAL_LIMIT.MAX ||
    !Array.from(reconcileTurnScopeIds).every(isCanonicalTurnScopeId) ||
    new Set(reconcileTurnScopeIds).size !== reconcileTurnScopeIds.length
  )
    throw new TypeError("Invalid lifecycle source selection");
  return { terminalLimit, reconcileTurnScopeIds: [...reconcileTurnScopeIds] };
}

export async function readTurnLifecycleReplacements({ sequence, turnScopeIds, read, invalid }) {
  const replacements = [];
  for (const turnScopeId of turnScopeIds) {
    const replacement = await read(turnScopeId);
    if (replacement === null) continue;
    if (
      replacement?.turnScopeId !== turnScopeId ||
      collectTurnReplacementTombstoneErrors(replacement, sequence).length
    )
      throw invalid("Invalid lifecycle replacement record");
    replacements.push([turnScopeId, replacement]);
  }
  return Object.fromEntries(replacements);
}

export function isTurnSnapshotKnownSequence(value) {
  return Number.isInteger(value) && value >= 0;
}

const EVENT_VALUES = new Set(TURN_EVENT_VALUES);
const EVENT_STATE = TURN_EVENT_STATE;
const EVENT_PHASE = TURN_EVENT_PHASE;
const FAILED_PHASE_STATE = TURN_FAILED_PHASE_STATE;

const TURN_LIFECYCLE_RECEIPT_FIELDS = Object.freeze([
  "action",
  "protocolVersion",
  "eventId",
  "sessionId",
  "turnScopeId",
]);

export function createTurnLifecycleReceipt({ eventId, sessionId, turnScopeId }) {
  const receipt = {
    action: TURN_LIFECYCLE_RECEIPT_ACTION,
    protocolVersion: TURN_LIFECYCLE_RECEIPT_PROTOCOL_VERSION,
    eventId,
    sessionId,
    turnScopeId,
  };
  const validation = validateTurnLifecycleReceipt(receipt);
  if (!validation.valid) {
    throw new TypeError(`invalid turn lifecycle receipt: ${validation.errors.join(",")}`);
  }
  return receipt;
}

export function validateTurnLifecycleReceipt(receipt) {
  if (!isObjectLike(receipt)) return { valid: false, errors: ["invalid_receipt"] };
  const errors = Object.keys(receipt)
    .filter((key) => !TURN_LIFECYCLE_RECEIPT_FIELDS.includes(key))
    .map((key) => `unknown_field:${key}`);
  if (receipt.action !== TURN_LIFECYCLE_RECEIPT_ACTION) errors.push("invalid_action");
  if (receipt.protocolVersion !== TURN_LIFECYCLE_RECEIPT_PROTOCOL_VERSION) {
    errors.push("unsupported_protocol_version");
  }
  if (!isCanonicalText(receipt.eventId)) errors.push("missing_event_id");
  if (!isCanonicalText(receipt.sessionId)) errors.push("missing_session_id");
  errors.push(...collectTurnScopeIdErrors(receipt.turnScopeId));
  return { valid: errors.length === 0, errors };
}

export function validateSessionProvisionIntent(input = {}) {
  if (input.initialSessionMetadata !== undefined && input.createSessionIfAbsent !== true)
    return { valid: false, requested: false, errors: ["metadata_requires_session_provision"] };
  if (input.initialSessionMetadata !== undefined && !isPlainObject(input.initialSessionMetadata))
    return { valid: false, requested: true, errors: ["invalid_initial_session_metadata"] };
  if (input.createSessionIfAbsent === undefined || input.createSessionIfAbsent === false) {
    return { valid: true, requested: false, errors: [] };
  }
  const valid =
    input.createSessionIfAbsent === true &&
    isSessionCaller(input.sessionCaller) &&
    clean(input.eventType) === TURN_EVENT.ACTION_ACCEPTED &&
    normalizeTurnCommitAction(input.action) === TURN_COMMIT_ACTION.SEND &&
    Number(input.expectedRevision ?? 0) === 0;
  return {
    valid,
    requested: input.createSessionIfAbsent === true,
    errors: valid ? [] : ["invalid_session_provision_intent"],
  };
}

export function createTurnLifecycleSnapshot({
  commandId,
  sessionId,
  sequence,
  activeTurnScopeId,
  activeTurn,
  recentTerminalTurns,
  replacedTurns,
  unchanged,
  recovery,
  generatedAt,
}) {
  const snapshot = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: TURN_EVENT.SNAPSHOT,
    commandId,
    sessionId,
    sequence,
    activeTurnScopeId: requireOptionalCanonicalTurnScopeId(activeTurnScopeId),
    activeTurn: activeTurn === null ? null : snapshotTurn(activeTurn),
    recentTerminalTurns: recentTerminalTurns.map(snapshotTurn),
    replacedTurns: replacedTurns.map(snapshotReplacedTurn),
    unchanged,
    recovery,
    generatedAt,
  };
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid) {
    throw Object.assign(
      new TypeError(`invalid turn lifecycle snapshot: ${validation.errors.join(",")}`),
      {
        code: "TURN_LIFECYCLE_SNAPSHOT_INVALID",
        errors: validation.errors,
      },
    );
  }
  return snapshot;
}

export { collectTurnReplacementTombstoneErrors } from "./lifecycle/turn-replacement.js";

function collectReplacementErrors(snapshot, errors) {
  const replacementScopes = new Set();
  for (const replacement of Array.isArray(snapshot.replacedTurns) ? snapshot.replacedTurns : []) {
    const turnScopeId = replacement?.turnScopeId;
    if (replacementScopes.has(turnScopeId)) errors.push("duplicate_replaced_turn_scope_id");
    replacementScopes.add(turnScopeId);
    errors.push(...collectTurnReplacementTombstoneErrors(replacement, snapshot.sequence));
  }
  return replacementScopes;
}

function collectSnapshotRuntimeErrors(turn) {
  const errors = collectTurnRecordErrors(turn);
  if (errors.length) return errors;
  try {
    projectTurnLifecycleRuntimeEvent(turn);
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

function collectMaterializedTurnErrors(turns, snapshot, errors) {
  for (const turn of turns) {
    if (!isObjectLike(turn)) {
      errors.push("invalid_snapshot_turn");
      continue;
    }
    if (!isCanonicalText(turn.sessionId)) errors.push("missing_turn_session_id");
    errors.push(...collectSnapshotTurnFieldErrors(turn));
    errors.push(...collectSnapshotRuntimeErrors(turn));
    if (turn.sessionId !== snapshot.sessionId) errors.push("turn_session_identity_mismatch");
    if (Number.isInteger(turn.sequence) && turn.sequence >= 1 && turn.sequence > snapshot.sequence)
      errors.push("turn_sequence_exceeds_snapshot");
  }
}

export function validateTurnLifecycleSnapshot(snapshot = {}) {
  if (!isObjectLike(snapshot)) {
    return { valid: false, errors: ["snapshot_not_object"] };
  }
  const errors = [];
  if (snapshot.protocolVersion !== TURN_LIFECYCLE_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (clean(snapshot.eventType) !== TURN_EVENT.SNAPSHOT) errors.push("invalid_snapshot_event_type");
  if (!clean(snapshot.commandId)) errors.push("missing_command_id");
  if (!clean(snapshot.sessionId)) errors.push("missing_session_id");
  if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0)
    errors.push("invalid_sequence");
  if (typeof snapshot.unchanged !== "boolean") errors.push("invalid_snapshot_unchanged");
  if (!isTurnRecoveryAction(snapshot.recovery)) errors.push("invalid_snapshot_recovery");
  else if (isActionableTurnRecovery(snapshot.recovery) && !snapshot.activeTurn)
    errors.push("recovery_without_active_turn");
  if (!Array.isArray(snapshot.recentTerminalTurns)) {
    return { valid: false, errors: [...errors, "missing_recent_terminal_turns"] };
  }
  const turns =
    snapshot.activeTurn === null
      ? snapshot.recentTerminalTurns
      : [snapshot.activeTurn, ...snapshot.recentTerminalTurns];
  collectMaterializedTurnErrors(turns, snapshot, errors);
  if (!Array.isArray(snapshot.replacedTurns)) errors.push("missing_replaced_turns");
  const replacementScopes = collectReplacementErrors(snapshot, errors);
  const materializedTurnScopes = new Set(
    turns.map((turn) => turn?.turnScopeId).filter(isCanonicalTurnScopeId),
  );
  if ([...replacementScopes].some((turnScopeId) => materializedTurnScopes.has(turnScopeId))) {
    errors.push("replaced_turn_still_materialized");
  }
  if (snapshot.activeTurn && snapshot.activeTurnScopeId !== snapshot.activeTurn.turnScopeId)
    errors.push("active_turn_identity_mismatch");
  if (snapshot.activeTurn && !clean(snapshot.activeTurn.startedAt)) {
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
  parentSessionId,
  turnScopeId,
  presentationMessageId = "",
  dialogProcessId,
  revision,
  sequence,
  phase,
  state,
  action = "",
  executionState = "",
  summaryVersion = 0,
  completionCommitId = "",
  updatedAt = "",
  startedAt,
  finishedAt,
  occurredAt,
  capabilities,
  failure = null,
  payload = {},
  executionId = "",
  executionKind = "",
  parentExecutionId = "",
  rootExecutionId = "",
  origin = {},
  stage = "",
  continuationSource = null,
  continuedByTurnScopeId = "",
}) {
  const executionIdentity = normalizeExecutionIdentity({
    executionId,
    executionKind,
    parentExecutionId,
    rootExecutionId,
    origin,
    stage,
  });
  const failureErrors = collectTurnFailureErrors(failure);
  if (failureErrors.length) throw new TypeError(failureErrors.join(","));
  const continuation = normalizeTurnContinuationSource(continuationSource);
  const envelope = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: clean(eventType),
    eventId: clean(eventId),
    commandId: clean(commandId),
    causationId: clean(causationId),
    correlationId: clean(correlationId),
    userId: clean(userId),
    sessionId: clean(sessionId),
    parentSessionId,
    turnScopeId: requireCanonicalTurnScopeId(turnScopeId),
    presentationMessageId: clean(presentationMessageId),
    dialogProcessId,
    revision,
    sequence,
    phase: clean(phase),
    state: clean(state),
    action: clean(action),
    executionState: clean(executionState).toLowerCase(),
    summaryVersion,
    completionCommitId: clean(completionCommitId),
    updatedAt: clean(updatedAt),
    startedAt,
    finishedAt,
    occurredAt,
    ...(isObjectLike(capabilities) ? { capabilities } : {}),
    ...(failure === null ? {} : { failure }),
    payload: isObjectLike(payload) ? payload : {},
    ...(continuation ? { continuationSource: continuation } : {}),
    continuedByTurnScopeId: requireOptionalCanonicalTurnScopeId(continuedByTurnScopeId),
    executionId: executionIdentity.executionId,
    executionKind: executionIdentity.executionKind,
    parentExecutionId: executionIdentity.parentExecutionId,
    rootExecutionId: executionIdentity.rootExecutionId,
    origin: executionIdentity.origin,
    stage: executionIdentity.stage,
  };
  return envelope;
}

function collectEnvelopeTimeErrors(envelope, errors) {
  if (!isCanonicalText(envelope.occurredAt)) errors.push("missing_occurred_at");
  if (!isCanonicalText(envelope.startedAt)) errors.push("missing_started_at");
  if (envelope.finishedAt !== "" && !isCanonicalText(envelope.finishedAt))
    errors.push("invalid_finished_at");
  else if (isTerminalTurnState(envelope.state) && envelope.finishedAt === "")
    errors.push("missing_finished_at");
}

function collectEnvelopeTransitionErrors(envelope, errors) {
  const eventType = clean(envelope.eventType);
  const phase = clean(envelope.phase);
  const expectedState =
    eventType === TURN_EVENT.FAILED ? FAILED_PHASE_STATE[phase] : EVENT_STATE[eventType];
  const expectedPhase = eventType === TURN_EVENT.FAILED ? phase : EVENT_PHASE[eventType];
  if (!expectedPhase || phase !== expectedPhase) errors.push("event_phase_mismatch");
  if (!expectedState || clean(envelope.state) !== expectedState)
    errors.push("event_state_mismatch");
  if (envelope.persistenceScope !== undefined) errors.push("unsupported_persistence_scope");
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && isTurnCommitContinuation(envelope.action)) {
    if (!normalizeTurnContinuationSource(envelope.continuationSource))
      errors.push("missing_continuation_source");
  } else if (
    eventType === TURN_EVENT.ACTION_ACCEPTED &&
    envelope.continuationSource !== undefined
  ) {
    errors.push("unexpected_continuation_source");
  }
  if (isCompletionCommitTurnEvent(envelope.eventType)) {
    if (!clean(envelope.completionCommitId)) errors.push("missing_completion_commit_id");
    if (!Number.isSafeInteger(envelope.summaryVersion) || envelope.summaryVersion < 1)
      errors.push("invalid_completion_summary_version");
  }
}

export function validateTurnLifecycleEnvelope(envelope) {
  if (!isObjectLike(envelope)) return { valid: false, errors: ["invalid_turn_lifecycle_envelope"] };
  const errors = [];
  if (envelope.protocolVersion !== TURN_LIFECYCLE_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (!EVENT_VALUES.has(envelope.eventType)) errors.push("invalid_event_type");
  if (!isCanonicalText(envelope.eventId)) errors.push("missing_event_id");
  collectEnvelopeTimeErrors(envelope, errors);
  if (!isCanonicalText(envelope.sessionId)) errors.push("missing_session_id");
  errors.push(...collectTurnScopeIdErrors(envelope.turnScopeId));
  errors.push(
    ...collectRequiredFieldErrors(
      envelope.presentationMessageId,
      "missing_presentation_message_id",
    ),
  );
  errors.push(...collectDialogProcessIdErrors(envelope.dialogProcessId));
  errors.push(...collectParentSessionIdErrors(envelope.parentSessionId));
  errors.push(...collectPositiveIntegerErrors(envelope.revision, "invalid_revision"));
  errors.push(...collectPositiveIntegerErrors(envelope.sequence, "invalid_sequence"));
  collectEnvelopeTransitionErrors(envelope, errors);
  if (errors.length === 0) {
    try {
      projectTurnLifecycleRuntimeEvent(envelope);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function isAuthoritativeTurnLifecycleEnvelope(envelope) {
  return validateTurnLifecycleEnvelope(envelope).valid;
}
