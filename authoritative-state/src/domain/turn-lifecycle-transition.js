/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TURN_EVENT,
  TURN_PHASE,
  createCommandRequestHash,
  decideCommandIdempotency,
  decideTurnContinuation,
  deriveAuthoritativeTurnCapabilities,
  deriveTurnExecutionState,
  isRetryableFinalizeFailure,
  isTerminalTurnState,
  normalizeTurnContinuationSource,
} from "@noobot/session-protocol";

const clean = (value) => String(value || "").trim();
const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

function normalizeOrigin(inputOrigin, currentOrigin) {
  if (!inputOrigin || typeof inputOrigin !== "object" || Array.isArray(inputOrigin)) {
    return currentOrigin || {};
  }
  return Object.fromEntries(
    Object.entries(inputOrigin).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function resolveLifecycleTransitionRequest(lifecycle, input, current) {
  const currentValue = current || {};
  const turnScopeId = clean(input.turnScopeId);
  const commandId = clean(input.commandId);
  const eventType = clean(input.eventType);
  const phase = clean(input.phase);
  const executionIdentity = {
    executionId: clean(input.executionId || currentValue.executionId) || `agent:${turnScopeId}`,
    executionKind: clean(input.executionKind || currentValue.executionKind) || "agent",
    parentExecutionId: clean(input.parentExecutionId || currentValue.parentExecutionId),
    rootExecutionId:
      clean(
        input.rootExecutionId ||
          currentValue.rootExecutionId ||
          input.executionId ||
          currentValue.executionId,
      ) || `agent:${turnScopeId}`,
    origin: normalizeOrigin(input.origin, currentValue.origin),
    stage: clean(input.stage || currentValue.stage),
  };
  const presentationMessageId = clean(
    input.presentationMessageId || currentValue.presentationMessageId,
  );
  const messageId = clean(input.messageId || currentValue.messageId);
  const action =
    eventType === TURN_EVENT.STOP_ACCEPTED ? "stop" : clean(input.action || currentValue.action);
  const continuationSource = normalizeTurnContinuationSource(
    input.continuationSource || currentValue.continuationSource,
  );
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
    messageId,
    action,
    continuationSource,
  };
}

function validateRequestIdentity(request) {
  const { lifecycle, input, current, turnScopeId, commandId, eventType } = request;
  if (!turnScopeId || !commandId || !eventType) return "invalid_lifecycle_identity";
  if (lifecycle.replacedTurns[turnScopeId]) return "turn_replaced";
  if (!request.messageId || !request.presentationMessageId)
    return "turn_message_identity_incomplete";
  if (
    current?.messageId &&
    clean(input.messageId) &&
    clean(input.messageId) !== current.messageId
  ) {
    return "turn_message_identity_conflict";
  }
  if (
    current?.presentationMessageId &&
    clean(input.presentationMessageId) &&
    clean(input.presentationMessageId) !== current.presentationMessageId
  ) {
    return "turn_presentation_identity_conflict";
  }
  return "";
}

function requestHashFor(request) {
  const { input } = request;
  return createCommandRequestHash({
    eventType: request.eventType,
    turnScopeId: request.turnScopeId,
    phase: request.phase,
    action: clean(input.action),
    userMessage:
      input.userMessage && typeof input.userMessage === "object"
        ? {
            content: String(input.userMessage.content || "").trim(),
            messageId: clean(input.userMessage.messageId),
            parentDialogProcessId: clean(input.userMessage.parentDialogProcessId),
            messageOrigin: input.userMessage.messageOrigin,
            userMetaMaterialized: input.userMessage.userMetaMaterialized === true,
          }
        : null,
    executionState: clean(input.executionState),
    startedAt: clean(input.startedAt),
    finishedAt: clean(input.finishedAt),
    presentationMessageId: request.presentationMessageId,
    messageId: request.messageId,
    continuationSource: request.continuationSource,
    completionCommitId: clean(input.completionCommitId),
    failure: input.failure && typeof input.failure === "object" ? input.failure : null,
    terminalStatus:
      input.terminalStatus && typeof input.terminalStatus === "object"
        ? input.terminalStatus
        : null,
    finalizePayload:
      input.finalizePayload && typeof input.finalizePayload === "object"
        ? input.finalizePayload
        : null,
    ...request.executionIdentity,
  });
}

function validateCurrentIdentity(request) {
  const { current, executionIdentity, input } = request;
  if (current) {
    const immutableFields = [
      "executionId",
      "executionKind",
      "parentExecutionId",
      "rootExecutionId",
    ];
    const conflict = immutableFields.some(
      (field) => clean(current[field]) !== clean(executionIdentity[field]),
    );
    if (
      conflict ||
      JSON.stringify(current.origin || {}) !== JSON.stringify(executionIdentity.origin || {})
    ) {
      return "execution_identity_conflict";
    }
  }
  if (
    input.expectedRevision !== undefined &&
    Number(input.expectedRevision) !== Number(current?.revision || 0)
  ) {
    return "turn_revision_conflict";
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
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && action === "continue") {
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

function createPendingFinalizeIntent(input, currentIntent, type, commandId, nowValue) {
  return {
    type,
    commandId: clean(input.finalizeCommandId) || `${commandId}:finalize`,
    retryable: true,
    createdAt: clean(currentIntent.createdAt) || nowValue,
    updatedAt: nowValue,
    payload:
      input.finalizePayload && typeof input.finalizePayload === "object"
        ? input.finalizePayload
        : {},
  };
}

function createRetryFinalizeIntent(input, currentIntent, type, commandId, nowValue) {
  return {
    ...currentIntent,
    type: clean(currentIntent.type) || type,
    commandId: clean(input.finalizeCommandId || currentIntent.commandId) || `${commandId}:retry`,
    retryable: true,
    createdAt: clean(currentIntent.createdAt) || nowValue,
    updatedAt: nowValue,
  };
}

function createFinalizeIntent({ input, current, eventType, phase, commandId, nowValue }) {
  const currentIntent = (current || {}).finalizeIntent || {};
  const type = resolveFinalizeType(eventType, phase);
  if (
    eventType === TURN_EVENT.PROCESSING_COMPLETED ||
    eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED
  ) {
    return createPendingFinalizeIntent(input, currentIntent, type, commandId, nowValue);
  }
  if (
    eventType === TURN_EVENT.FAILED &&
    (phase === TURN_PHASE.COMPLETION || phase === TURN_PHASE.STOP) &&
    (input.failure || {}).retryable === true
  ) {
    return createRetryFinalizeIntent(input, currentIntent, type, commandId, nowValue);
  }
  if (eventType === TURN_EVENT.COMPLETED || eventType === TURN_EVENT.STOP_COMPLETED) return null;
  return currentIntent.type ? currentIntent : null;
}

export function projectLifecycleTransition(request, transition, nowValue) {
  const { input, current, turnScopeId, commandId, eventType, phase } = request;
  const currentValue = current || {};
  const state = transition.nextState;
  const revision = Number(currentValue.revision || 0) + 1;
  const sequence = request.lifecycle.sequence + 1;
  const turn = {
    ...(current || {}),
    turnScopeId,
    messageId: request.messageId,
    presentationMessageId: request.presentationMessageId,
    ...request.executionIdentity,
    dialogProcessId: clean(input.dialogProcessId || currentValue.dialogProcessId),
    commandId,
    action: request.action,
    state,
    phase,
    executionState: deriveTurnExecutionState(
      eventType,
      input.executionState || currentValue.executionState,
    ),
    revision,
    sequence,
    summaryVersion: integer(input.summaryVersion, integer(currentValue.summaryVersion)),
    completionCommitId: clean(input.completionCommitId || currentValue.completionCommitId),
    terminalStatus:
      input.terminalStatus &&
      typeof input.terminalStatus === "object" &&
      !Array.isArray(input.terminalStatus)
        ? { ...input.terminalStatus }
        : currentValue.terminalStatus || null,
    failure: eventType === TURN_EVENT.FAILED ? { ...(input.failure || {}), phase } : null,
    finalizeIntent: createFinalizeIntent({ input, current, eventType, phase, commandId, nowValue }),
    continuationSource: request.continuationSource,
    continuedByTurnScopeId: clean(currentValue.continuedByTurnScopeId),
    startedAt:
      clean(input.startedAt || currentValue.startedAt) || clean(currentValue.createdAt) || nowValue,
    finishedAt: isTerminalTurnState(state)
      ? clean(input.finishedAt) || nowValue
      : clean(currentValue.finishedAt),
    createdAt: clean(currentValue.createdAt) || nowValue,
    updatedAt: nowValue,
  };
  return { turn, revision, sequence };
}

export function commitLifecycleTransition(request, projection, requestHash, nowValue) {
  const { lifecycle, turnScopeId, commandId, eventType } = request;
  const { turn, revision, sequence } = projection;
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && request.action === "continue") {
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
