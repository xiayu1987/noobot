/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TURN_ACTION,
  TURN_EVENT,
  TURN_PHASE,
  createCommandRequestHash,
  decideCommandIdempotency,
  decideTurnContinuation,
  deriveAuthoritativeTurnCapabilities,
  deriveTurnExecutionState,
  isRetryableFinalizeFailure,
  isRetryableFinalizeFailureEvent,
  isCompletionCommitTurnEvent,
  isFinalizeRequestTurnEvent,
  isSettlingTurnEvent,
  isTerminalTurnState,
  normalizeTurnContinuationSource,
  normalizeTurnFailure,
  normalizeTurnTerminalStatus,
  validateExecutionIdentity,
} from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";

const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

function normalizeOrigin(origin) {
  if (!isPlainObject(origin)) return {};
  return Object.fromEntries(
    Object.entries(origin).sort(([left], [right]) => left.localeCompare(right)),
  );
}

const EXECUTION_IDENTITY_FIELDS = Object.freeze([
  "executionId",
  "executionKind",
  "parentExecutionId",
  "rootExecutionId",
  "stage",
]);

function pickExecutionIdentity(source) {
  return {
    ...Object.fromEntries(EXECUTION_IDENTITY_FIELDS.map((field) => [field, text(source[field])])),
    origin: normalizeOrigin(source.origin),
  };
}

function resolveRequestAction(eventType, input, current) {
  if (eventType === TURN_EVENT.STOP_ACCEPTED) return TURN_ACTION.STOP;
  return text(current ? current.action : input.action);
}

export function resolveLifecycleTransitionRequest(lifecycle, input, current) {
  const identitySource = current || input;
  const turnScopeId = text(input.turnScopeId);
  const commandId = text(input.commandId);
  const eventType = text(input.eventType);
  const phase = text(input.phase);
  const executionIdentity = pickExecutionIdentity(identitySource);
  const presentationMessageId = text(identitySource.presentationMessageId);
  const dialogProcessId = text(identitySource.dialogProcessId);
  const action = resolveRequestAction(eventType, input, current);
  const continuationSource = normalizeTurnContinuationSource(identitySource.continuationSource);
  return {
    lifecycle,
    input,
    current,
    turnScopeId,
    commandId,
    eventType,
    phase,
    executionIdentity,
    presentationMessageId,
    dialogProcessId,
    action,
    continuationSource,
  };
}

const STORED_IDENTITY_CONFLICTS = Object.freeze([
  ["presentationMessageId", "turn_presentation_identity_conflict"],
  ["dialogProcessId", "turn_dialog_process_identity_conflict"],
]);

function findStoredIdentityConflict(input, current) {
  const conflict = STORED_IDENTITY_CONFLICTS.find(([field]) => {
    const proposed = text(input[field]);
    return current[field] && proposed && proposed !== current[field];
  });
  return conflict ? conflict[1] : "";
}

function validateRequestIdentity(request) {
  const { lifecycle, input, current, turnScopeId, commandId, eventType } = request;
  if (!turnScopeId || !commandId || !text(input.causationId) || !eventType) {
    return "invalid_lifecycle_identity";
  }
  if (lifecycle.replacedTurns[turnScopeId]) return "turn_replaced";
  if (!request.presentationMessageId) return "turn_message_identity_incomplete";
  if (!current) return text(input.startedAt) ? "" : "turn_started_at_missing";
  return findStoredIdentityConflict(input, current);
}

function requestHashFor(request) {
  const { input } = request;
  return createCommandRequestHash({
    eventType: request.eventType,
    turnScopeId: request.turnScopeId,
    phase: request.phase,
    action: text(input.action),
    userMessage:
      input.userMessage && typeof input.userMessage === "object"
        ? {
            content: text(input.userMessage.content),
            messageId: text(input.userMessage.messageId),
            parentDialogProcessId: text(input.userMessage.parentDialogProcessId),
            messageOrigin: input.userMessage.messageOrigin,
            userMetaMaterialized: input.userMessage.userMetaMaterialized === true,
          }
        : null,
    startedAt: text(input.startedAt),
    finishedAt: text(input.finishedAt),
    presentationMessageId: request.presentationMessageId,
    continuationSource: request.continuationSource,
    completionCommitId: text(input.completionCommitId),
    failure: input.failure && typeof input.failure === "object" ? input.failure : null,
    terminalStatus: normalizeTurnTerminalStatus(input.terminalStatus),
    finalizePayload:
      input.finalizePayload && typeof input.finalizePayload === "object"
        ? input.finalizePayload
        : null,
    ...pickExecutionIdentity(input),
  });
}

function executionIdentityFailure({ current, executionIdentity, input, turnScopeId }) {
  if (!current) {
    const validation = validateExecutionIdentity({
      ...executionIdentity,
      sessionId: input.sessionId,
      turnScopeId,
    });
    return validation.valid ? "" : "execution_identity_invalid";
  }
  const conflict = EXECUTION_IDENTITY_FIELDS.some(
    (field) => text(input[field]) && text(input[field]) !== executionIdentity[field],
  );
  const originConflict =
    isPlainObject(input.origin) &&
    Object.keys(input.origin).length > 0 &&
    JSON.stringify(normalizeOrigin(input.origin)) !== JSON.stringify(executionIdentity.origin);
  return conflict || originConflict ? "execution_identity_conflict" : "";
}

function validateCurrentIdentity(request) {
  const { current, input } = request;
  const identityFailure = executionIdentityFailure(request);
  if (identityFailure) return identityFailure;
  if (
    input.expectedRevision !== undefined &&
    Number(input.expectedRevision) !== Number(current?.revision || 0)
  ) {
    return "turn_revision_conflict";
  }
  return "";
}

function validateFinalizeCommit(request) {
  const { input, current, eventType, phase, commandId } = request;
  if (isFinalizeRequestTurnEvent(eventType)) {
    return text(input.completionCommitId) ? "" : "missing_completion_commit_id";
  }
  if (text(input.completionCommitId)) return "unexpected_completion_commit_id";
  const intentCommandId = text(current?.finalizeIntent?.commandId);
  if (isRetryableFinalizeFailureEvent({ eventType, phase, failure: input.failure })) {
    return intentCommandId ? "" : "finalize_intent_missing";
  }
  if (isCompletionCommitTurnEvent(eventType)) {
    if (!intentCommandId) return "finalize_intent_missing";
    return intentCommandId === commandId ? "" : "completion_commit_id_conflict";
  }
  return "";
}

function validateRequestedAction(request) {
  const { lifecycle, current, eventType, turnScopeId, action, continuationSource } = request;
  if (
    eventType === TURN_EVENT.ACTION_ACCEPTED &&
    lifecycle.activeTurnScopeId &&
    lifecycle.activeTurnScopeId !== turnScopeId
  ) {
    return "session_action_conflict";
  }
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && action === TURN_ACTION.CONTINUE) {
    if (!continuationSource) return "continue_source_identity_incomplete";
    const continuation = decideTurnContinuation({
      lifecycle,
      turnScopeId,
      source: continuationSource,
    });
    return continuation.allowed ? "" : continuation.reason;
  }
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && continuationSource) {
    return "unexpected_continuation_source";
  }
  if (
    eventType === TURN_EVENT.FAILED &&
    (!text(request.input.failure?.code) || !text(request.input.failure?.message))
  ) {
    return "turn_failure_incomplete";
  }
  const finalizeFailure = validateFinalizeCommit(request);
  if (finalizeFailure) return finalizeFailure;
  if (
    eventType === TURN_EVENT.STOP_ACCEPTED &&
    !deriveAuthoritativeTurnCapabilities(current || {}).canStop
  ) {
    return "stop_not_allowed";
  }
  return "";
}

export function decideLifecycleTransitionRequest(request) {
  const identityFailure = validateRequestIdentity(request);
  if (identityFailure) return { allowed: false, reason: identityFailure };
  const requestHash = requestHashFor(request);
  const idempotency = decideCommandIdempotency({
    commandId: request.commandId,
    type: request.eventType,
    requestHash,
    receipts: request.lifecycle.commandReceipts,
  });
  if (!idempotency.allowed) return { allowed: false, reason: "idempotency_key_reused" };
  if (idempotency.deduplicated) {
    return {
      allowed: false,
      deduplicated: true,
      reason: "duplicate_command",
      requestHash,
      idempotency,
    };
  }
  const currentFailure = validateCurrentIdentity(request);
  if (currentFailure) return { allowed: false, reason: currentFailure, requestHash };
  const actionFailure = validateRequestedAction(request);
  if (actionFailure) return { allowed: false, reason: actionFailure, requestHash };
  return { allowed: true, requestHash };
}

function resolveFinalizeType(eventType, phase) {
  return phase === TURN_PHASE.STOP || eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED
    ? "stop"
    : "completion";
}

function createPendingFinalizeIntent(input, currentIntent, type, nowValue) {
  return {
    type,
    commandId: text(input.completionCommitId),
    retryable: true,
    createdAt: text(currentIntent.createdAt) || nowValue,
    updatedAt: nowValue,
    payload:
      input.finalizePayload && typeof input.finalizePayload === "object"
        ? input.finalizePayload
        : {},
  };
}

function createRetryFinalizeIntent(currentIntent, nowValue) {
  return {
    ...currentIntent,
    retryable: true,
    updatedAt: nowValue,
  };
}

function createFinalizeIntent({ input, current, eventType, phase, nowValue }) {
  const currentIntent = (current || {}).finalizeIntent || {};
  if (isFinalizeRequestTurnEvent(eventType)) {
    const type = resolveFinalizeType(eventType, phase);
    return createPendingFinalizeIntent(input, currentIntent, type, nowValue);
  }
  if (isRetryableFinalizeFailureEvent({ eventType, phase, failure: input.failure })) {
    return createRetryFinalizeIntent(currentIntent, nowValue);
  }
  if (isCompletionCommitTurnEvent(eventType)) return null;
  return currentIntent.type ? currentIntent : null;
}

export function projectLifecycleTransition(request, transition, nowValue) {
  const { input, current, turnScopeId, commandId, eventType, phase } = request;
  const currentValue = current || {};
  const state = transition.nextState;
  const revision = Number(currentValue.revision || 0) + 1;
  const sequence = request.lifecycle.sequence + 1;
  const settling = isSettlingTurnEvent({ eventType, phase, failure: input.failure });
  const turn = {
    ...(current || {}),
    turnScopeId,
    presentationMessageId: request.presentationMessageId,
    ...request.executionIdentity,
    dialogProcessId: request.dialogProcessId,
    commandId,
    action: request.action,
    state,
    phase,
    executionState: deriveTurnExecutionState(eventType, currentValue.executionState),
    revision,
    sequence,
    summaryVersion: integer(input.summaryVersion, integer(currentValue.summaryVersion)),
    completionCommitId: isCompletionCommitTurnEvent(eventType)
      ? commandId
      : text(currentValue.completionCommitId),
    terminalStatus: normalizeTurnTerminalStatus(
      settling ? input.terminalStatus : currentValue.terminalStatus,
    ),
    failure: eventType === TURN_EVENT.FAILED ? normalizeTurnFailure(input.failure) : null,
    finalizeIntent: createFinalizeIntent({ input, current, eventType, phase, nowValue }),
    continuationSource: request.continuationSource,
    continuedByTurnScopeId: text(currentValue.continuedByTurnScopeId),
    startedAt: current ? current.startedAt : text(input.startedAt),
    finishedAt: isTerminalTurnState(state)
      ? text(input.finishedAt) || nowValue
      : text(currentValue.finishedAt),
    createdAt: text(currentValue.createdAt) || nowValue,
    updatedAt: nowValue,
  };
  return { turn, revision, sequence };
}

export function commitLifecycleTransition(request, projection, requestHash, nowValue) {
  const { lifecycle, turnScopeId, commandId, eventType } = request;
  const { turn, revision, sequence } = projection;
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && request.action === TURN_ACTION.CONTINUE) {
    lifecycle.turns[request.continuationSource.turnScopeId].continuedByTurnScopeId = turnScopeId;
  }
  lifecycle.turns[turnScopeId] = turn;
  lifecycle.sequence = sequence;
  lifecycle.activeTurnScopeId =
    isTerminalTurnState(turn.state) && !isRetryableFinalizeFailure(turn) ? "" : turnScopeId;
  lifecycle.commandReceipts.push({
    commandId,
    type: eventType,
    turnScopeId,
    requestHash,
    revision,
    sequence,
    committedAt: nowValue,
    eventId: "",
    envelope: null,
  });
  return { applied: true, lifecycle, turn };
}
