/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TURN_ACTION,
  assertTurnRecord,
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
  normalizeTurnTerminalStatus,
  validateExecutionIdentity,
  selectTurnRequestExecutionIdentity,
  findTurnExecutionIdentityConflict,
  TURN_REQUEST_EXECUTION_FIELDS,
} from "@noobot/session-protocol";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

function resolveRequestAction(eventType, input, current) {
  if (eventType === TURN_EVENT.STOP_ACCEPTED) return TURN_ACTION.STOP;
  return current ? current.action : input.action;
}

export function resolveLifecycleTransitionRequest(lifecycle, input, current) {
  const identitySource = current || input;
  const { turnScopeId, commandId, eventType, phase } = input;
  const executionIdentity = selectTurnRequestExecutionIdentity(identitySource);
  const presentationMessageId = identitySource.presentationMessageId;
  const dialogProcessId = identitySource.dialogProcessId;
  const action = resolveRequestAction(eventType, input, current);
  const continuationSource = current
    ? current.continuationSource
    : (input.continuationSource ?? null);
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
    return Object.hasOwn(input, field) && input[field] !== current[field];
  });
  return conflict ? conflict[1] : "";
}

function validateRequestIdentity(request) {
  const { lifecycle, input, current, turnScopeId, eventType } = request;
  if (
    !isCanonicalText(input.turnScopeId) ||
    !isCanonicalText(input.commandId) ||
    !isCanonicalText(input.causationId) ||
    !eventType
  ) {
    return "invalid_lifecycle_identity";
  }
  if (lifecycle.replacedTurns[turnScopeId]) return "turn_replaced";
  if (!isCanonicalText(current ? current.presentationMessageId : input.presentationMessageId))
    return "turn_message_identity_incomplete";
  if (!isCanonicalText(request.dialogProcessId)) return "missing_dialog_process_id";
  if (!current) return "";
  return findStoredIdentityConflict(input, current);
}

function requestHashFor(request) {
  const { input } = request;
  const terminalStatus = normalizeTurnTerminalStatus(input.terminalStatus);
  const terminalRequest =
    terminalStatus === null
      ? null
      : Object.fromEntries(
          Object.entries(terminalStatus).filter(([field]) => field !== "updatedAt"),
        );
  return createCommandRequestHash({
    eventType: request.eventType,
    turnScopeId: request.turnScopeId,
    phase: request.phase,
    action: input.action,
    userMessage:
      input.userMessage && typeof input.userMessage === "object"
        ? {
            content: input.userMessage.content,
            userMessageId: input.userMessage.userMessageId,
            parentDialogProcessId: input.userMessage.parentDialogProcessId,
            messageOrigin: input.userMessage.messageOrigin,
          }
        : null,
    presentationMessageId: request.presentationMessageId,
    continuationSource: request.continuationSource,
    completionCommitId: input.completionCommitId,
    failure: Object.hasOwn(input, "failure") ? input.failure : null,
    terminalStatus: terminalRequest,
    ...selectTurnRequestExecutionIdentity(input),
  });
}

function executionIdentityFailure({ current, executionIdentity, input, turnScopeId }) {
  if (!current) {
    if (
      !isPlainObject(executionIdentity.origin) ||
      TURN_REQUEST_EXECUTION_FIELDS.some(
        (field) => executionIdentity[field] !== "" && !isCanonicalText(executionIdentity[field]),
      )
    )
      return "execution_identity_invalid";
    const validation = validateExecutionIdentity({
      ...executionIdentity,
      sessionId: input.sessionId,
      turnScopeId,
    });
    return validation.valid ? "" : "execution_identity_invalid";
  }
  return findTurnExecutionIdentityConflict(input, executionIdentity)
    ? "execution_identity_conflict"
    : "";
}

function validateCurrentIdentity(request) {
  const { current, input } = request;
  const identityFailure = executionIdentityFailure(request);
  if (identityFailure) return identityFailure;
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== (current ? current.revision : 0)
  ) {
    return "turn_revision_conflict";
  }
  return "";
}

function validateFinalizeCommit(request) {
  const { input, current, eventType, phase, commandId } = request;
  if (isFinalizeRequestTurnEvent(eventType)) {
    return input.completionCommitId ? "" : "missing_completion_commit_id";
  }
  if (input.completionCommitId) return "unexpected_completion_commit_id";
  const intentCommandId = current?.finalizeIntent?.commandId;
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
    commandId: input.completionCommitId,
    retryable: true,
    createdAt: currentIntent ? currentIntent.createdAt : nowValue,
    updatedAt: nowValue,
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
  const currentIntent = current ? current.finalizeIntent : null;
  if (isFinalizeRequestTurnEvent(eventType)) {
    const type = resolveFinalizeType(eventType, phase);
    return createPendingFinalizeIntent(input, currentIntent, type, nowValue);
  }
  if (isRetryableFinalizeFailureEvent({ eventType, phase, failure: input.failure })) {
    return createRetryFinalizeIntent(currentIntent, nowValue);
  }
  if (isCompletionCommitTurnEvent(eventType)) return null;
  if (eventType === TURN_EVENT.FAILED) return null;
  return currentIntent;
}

function projectCompletionCoordinates({ input, current, eventType }, state, nowValue) {
  let summaryVersion = current ? current.summaryVersion : 0;
  if (Object.hasOwn(input, "summaryVersion")) summaryVersion = input.summaryVersion;
  let completionCommitId = current ? current.completionCommitId : "";
  if (isCompletionCommitTurnEvent(eventType)) completionCommitId = input.commandId;

  let finishedAt = current ? current.finishedAt : "";
  if (isTerminalTurnState(state)) finishedAt = nowValue;
  return { summaryVersion, completionCommitId, finishedAt };
}

export function projectLifecycleTransition(request, transition, nowValue) {
  const { input, current, turnScopeId, commandId, eventType, phase } = request;
  const currentValue = current || {};
  const state = transition.nextState;
  const revision = current ? current.revision + 1 : 1;
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
    ...projectCompletionCoordinates(request, state, nowValue),
    terminalStatus: normalizeTurnTerminalStatus(
      settling ? input.terminalStatus : currentValue.terminalStatus,
    ),
    failure: eventType === TURN_EVENT.FAILED ? structuredClone(input.failure) : null,
    finalizeIntent: createFinalizeIntent({ input, current, eventType, phase, nowValue }),
    continuationSource: request.continuationSource,
    continuedByTurnScopeId: current ? current.continuedByTurnScopeId : "",

    startedAt: current ? current.startedAt : nowValue,
    createdAt: current ? current.createdAt : nowValue,
    updatedAt: nowValue,
  };
  return { turn, revision, sequence };
}

export function commitLifecycleTransition(request, projection, requestHash, nowValue) {
  const { lifecycle, turnScopeId, commandId, eventType } = request;
  const { turn, revision, sequence } = projection;
  assertTurnRecord(turn);
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && request.action === TURN_ACTION.CONTINUE) {
    lifecycle.turns[request.continuationSource.turnScopeId].continuedByTurnScopeId = turnScopeId;
  }
  lifecycle.turns[turnScopeId] = turn;
  lifecycle.sequence = sequence;
  lifecycle.activeTurnScopeId =
    isTerminalTurnState(turn.state) && !isRetryableFinalizeFailure(turn) ? "" : turnScopeId;

  const receiptDraft = {
    commandId,
    type: eventType,
    turnScopeId,
    requestHash,
    revision,
    sequence,
    committedAt: nowValue,
  };
  return { applied: true, lifecycle, turn, receiptDraft };
}
