/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
  deriveAuthoritativeTurnCapabilities,
  normalizeTurnContinuationSource,
  validateTurnLifecycleEnvelope,
} from "@noobot/session-protocol/turn-lifecycle";

const TERMINAL_STATES = new Set([
  TURN_STATE.COMPLETED,
  TURN_STATE.STOP_COMPLETED,
  TURN_STATE.ACTION_FAILED,
  TURN_STATE.PROCESSING_FAILED,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOP_FAILED,
]);

const FINALIZE_FAILURE_STATES = new Set([
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOP_FAILED,
]);

const clean = (value) => String(value || "").trim();
const integer = (value, fallback = 0) => Number.isInteger(Number(value)) && Number(value) >= 0
  ? Number(value)
  : fallback;

export function normalizeTurnLifecycleEntity(source = {}) {
  const turns = {};
  for (const [key, value] of Object.entries(source?.turns || {})) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const turnScopeId = clean(value.turnScopeId || key);
    if (!turnScopeId) continue;
    turns[turnScopeId] = {
      turnScopeId,
      messageId: clean(value.messageId),
      presentationMessageId: clean(value.presentationMessageId),
      executionId: clean(value.executionId) || `agent:${turnScopeId}`,
      executionKind: clean(value.executionKind) || "agent",
      parentExecutionId: clean(value.parentExecutionId),
      rootExecutionId: clean(value.rootExecutionId) || clean(value.executionId) || `agent:${turnScopeId}`,
      origin: value.origin && typeof value.origin === "object" && !Array.isArray(value.origin) ? { ...value.origin } : {},
      stage: clean(value.stage),
      dialogProcessId: clean(value.dialogProcessId),
      commandId: clean(value.commandId),
      action: clean(value.action),
      state: clean(value.state),
      phase: clean(value.phase),
      executionState: clean(value.executionState).toLowerCase(),
      revision: integer(value.revision),
      sequence: integer(value.sequence),
      summaryVersion: integer(value.summaryVersion),
      completionCommitId: clean(value.completionCommitId),
      terminalStatus: value.terminalStatus && typeof value.terminalStatus === "object" && !Array.isArray(value.terminalStatus)
        ? { ...value.terminalStatus }
        : null,
      failure: value.failure && typeof value.failure === "object" && !Array.isArray(value.failure)
        ? { ...value.failure, phase: clean(value.failure.phase || value.phase) }
        : null,
      finalizeIntent: value.finalizeIntent && typeof value.finalizeIntent === "object" && !Array.isArray(value.finalizeIntent)
        ? {
            type: clean(value.finalizeIntent.type),
            commandId: clean(value.finalizeIntent.commandId),
            retryable: value.finalizeIntent.retryable !== false,
            createdAt: clean(value.finalizeIntent.createdAt),
            updatedAt: clean(value.finalizeIntent.updatedAt),
            payload: value.finalizeIntent.payload && typeof value.finalizeIntent.payload === "object" && !Array.isArray(value.finalizeIntent.payload)
              ? { ...value.finalizeIntent.payload }
              : {},
          }
        : null,
      continuationSource: normalizeTurnContinuationSource(value.continuationSource),
      continuedByTurnScopeId: clean(value.continuedByTurnScopeId),
      startedAt: clean(value.startedAt),
      finishedAt: clean(value.finishedAt),
      createdAt: clean(value.createdAt),
      updatedAt: clean(value.updatedAt),
    };
  }
  const replacedTurns = {};
  for (const [key, value] of Object.entries(source?.replacedTurns || {})) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const turnScopeId = clean(value.turnScopeId || key);
    const replacementTurnScopeId = clean(value.replacementTurnScopeId);
    const commandId = clean(value.commandId);
    if (!turnScopeId || !replacementTurnScopeId || !commandId) continue;
    replacedTurns[turnScopeId] = {
      turnScopeId,
      replacementDialogProcessId: clean(value.replacementDialogProcessId),
      replacementTurnScopeId,
      replacementUserMessageId: clean(value.replacementUserMessageId),
      commandId,
      committedAggregateVersion: integer(value.committedAggregateVersion),
      replacedTurnScopeIds: [...new Set(
        (Array.isArray(value.replacedTurnScopeIds) ? value.replacedTurnScopeIds : [turnScopeId])
          .map(clean)
          .filter(Boolean),
      )],
      sequence: integer(value.sequence),
      committedAt: clean(value.committedAt),
    };
  }
  const commandReceipts = (Array.isArray(source?.commandReceipts) ? source.commandReceipts : [])
    .filter((item) => item && typeof item === "object" && clean(item.commandId))
    .map((item) => {
      const eventId = clean(item.eventId || item.envelope?.eventId);
      const envelope = item.envelope && typeof item.envelope === "object" && !Array.isArray(item.envelope)
        ? { ...item.envelope, eventId }
        : null;
      return {
        commandId: clean(item.commandId),
        eventType: clean(item.eventType),
        turnScopeId: clean(item.turnScopeId),
        requestHash: clean(item.requestHash),
        revision: integer(item.revision),
        sequence: integer(item.sequence),
        committedAt: clean(item.committedAt),
        eventId,
        envelope: validateTurnLifecycleEnvelope(envelope || {}).valid ? envelope : null,
      };
    });
  const activeTurnScopeId = clean(source?.activeTurnScopeId);
  return {
    activeTurnScopeId: turns[activeTurnScopeId] && (
      !TERMINAL_STATES.has(turns[activeTurnScopeId].state) ||
      (FINALIZE_FAILURE_STATES.has(turns[activeTurnScopeId].state) && turns[activeTurnScopeId].finalizeIntent?.retryable === true)
    )
      ? activeTurnScopeId
      : "",
    sequence: Math.max(
      integer(source?.sequence),
      ...Object.values(turns).map((turn) => turn.sequence),
      ...Object.values(replacedTurns).map((turn) => turn.sequence),
    ),
    turns,
    replacedTurns,
    commandReceipts,
  };
}

function nextState(eventType, phase) {
  if (eventType === TURN_EVENT.ACTION_ACCEPTED) return TURN_STATE.ACTION_REQUESTING;
  if (eventType === TURN_EVENT.PROCESSING_STARTED) return TURN_STATE.PROCESSING;
  if (eventType === TURN_EVENT.PROCESSING_COMPLETED) return TURN_STATE.COMPLETION_REQUESTING;
  if (eventType === TURN_EVENT.STOP_ACCEPTED) return TURN_STATE.ACTION_REQUESTING;
  if (eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED) return TURN_STATE.STOPPING;
  if (eventType === TURN_EVENT.COMPLETED) return TURN_STATE.COMPLETED;
  if (eventType === TURN_EVENT.STOP_COMPLETED) return TURN_STATE.STOP_COMPLETED;
  if (eventType === TURN_EVENT.FAILED) {
    if (phase === TURN_PHASE.ACTION) return TURN_STATE.ACTION_FAILED;
    if (phase === TURN_PHASE.PROCESSING) return TURN_STATE.PROCESSING_FAILED;
    if (phase === TURN_PHASE.COMPLETION) return TURN_STATE.COMPLETION_FAILED;
    if (phase === TURN_PHASE.STOP) return TURN_STATE.STOP_FAILED;
  }
  return "";
}

function nextExecutionState(eventType, currentExecutionState = "") {
  if (eventType === TURN_EVENT.COMPLETED) return "completed";
  if (eventType === TURN_EVENT.STOP_COMPLETED) return "user_stopped";
  if (eventType === TURN_EVENT.FAILED) return "error";
  return clean(currentExecutionState).toLowerCase();
}

function allowed(current, eventType) {
  if (!current) return eventType === TURN_EVENT.ACTION_ACCEPTED;
  if (eventType === TURN_EVENT.PROCESSING_STARTED) return current.state === TURN_STATE.ACTION_REQUESTING && current.action !== "stop";
  if (eventType === TURN_EVENT.PROCESSING_COMPLETED) return current.state === TURN_STATE.PROCESSING;
  if (eventType === TURN_EVENT.STOP_ACCEPTED) return deriveAuthoritativeTurnCapabilities(current).canStop;
  if (eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED) return current.state === TURN_STATE.ACTION_REQUESTING && current.action === "stop";
  if (eventType === TURN_EVENT.COMPLETED) return current.state === TURN_STATE.COMPLETION_REQUESTING || (current.state === TURN_STATE.COMPLETION_FAILED && current.finalizeIntent?.retryable === true);
  if (eventType === TURN_EVENT.STOP_COMPLETED) return current.state === TURN_STATE.STOPPING || (current.state === TURN_STATE.STOP_FAILED && current.finalizeIntent?.retryable === true);
  if (eventType === TURN_EVENT.FAILED) return !TERMINAL_STATES.has(current.state);
  return false;
}

export function transitionTurnLifecycle(source = {}, input = {}, now = () => new Date().toISOString()) {
  const lifecycle = normalizeTurnLifecycleEntity(source);
  const turnScopeId = clean(input.turnScopeId);
  const commandId = clean(input.commandId);
  const eventType = clean(input.eventType);
  const phase = clean(input.phase);
  if (!turnScopeId || !commandId || !eventType) return { applied: false, reason: "invalid_lifecycle_identity", lifecycle };
  if (lifecycle.replacedTurns[turnScopeId]) {
    return {
      applied: false,
      reason: "turn_replaced",
      replacement: lifecycle.replacedTurns[turnScopeId],
      lifecycle,
    };
  }

  const current = lifecycle.turns[turnScopeId] || null;
  const requestedExecutionIdentity = {
    executionId: clean(input.executionId || current?.executionId) || `agent:${turnScopeId}`,
    executionKind: clean(input.executionKind || current?.executionKind) || "agent",
    parentExecutionId: clean(input.parentExecutionId || current?.parentExecutionId),
    rootExecutionId: clean(input.rootExecutionId || current?.rootExecutionId || input.executionId || current?.executionId) || `agent:${turnScopeId}`,
    origin: input.origin && typeof input.origin === "object" && !Array.isArray(input.origin)
      ? Object.fromEntries(Object.entries(input.origin).sort(([left], [right]) => left.localeCompare(right)))
      : current?.origin || {},
    stage: clean(input.stage || current?.stage),
  };
  const requestedPresentationMessageId = clean(
    input.presentationMessageId || current?.presentationMessageId,
  );
  const requestedMessageId = clean(input.messageId || current?.messageId);
  const requestedAction = eventType === TURN_EVENT.STOP_ACCEPTED
    ? "stop"
    : clean(input.action || current?.action);
  const requestedContinuationSource = normalizeTurnContinuationSource(
    input.continuationSource || current?.continuationSource,
  );
  if (!requestedMessageId || !requestedPresentationMessageId) {
    return { applied: false, reason: "turn_message_identity_incomplete", lifecycle };
  }
  if (current?.messageId && clean(input.messageId) && clean(input.messageId) !== current.messageId) {
    return { applied: false, reason: "turn_message_identity_conflict", lifecycle };
  }
  if (
    current?.presentationMessageId &&
    clean(input.presentationMessageId) &&
    clean(input.presentationMessageId) !== current.presentationMessageId
  ) {
    return { applied: false, reason: "turn_presentation_identity_conflict", lifecycle };
  }
  const requestHash = JSON.stringify({
    eventType,
    turnScopeId,
    phase,
    action: clean(input.action),
    executionState: clean(input.executionState),
    startedAt: clean(input.startedAt),
    finishedAt: clean(input.finishedAt),
    presentationMessageId: requestedPresentationMessageId,
    messageId: requestedMessageId,
    continuationSource: requestedContinuationSource,
    ...requestedExecutionIdentity,
  });
  const receipt = lifecycle.commandReceipts.find((item) => item.commandId === commandId && item.eventType === eventType);
  if (receipt) {
    if (receipt.requestHash !== requestHash) return { applied: false, reason: "idempotency_key_reused", lifecycle };
    return { applied: false, deduplicated: true, reason: "duplicate_command", lifecycle, turn: lifecycle.turns[receipt.turnScopeId] };
  }

  if (current) {
    const immutableExecutionFields = [
      "executionId",
      "executionKind",
      "parentExecutionId",
      "rootExecutionId",
    ];
    const hasExecutionIdentityConflict = immutableExecutionFields.some((field) =>
      clean(current[field]) !== clean(requestedExecutionIdentity[field]),
    );
    const currentOrigin = JSON.stringify(current.origin || {});
    const requestedOrigin = JSON.stringify(requestedExecutionIdentity.origin || {});
    if (hasExecutionIdentityConflict || currentOrigin !== requestedOrigin) {
      return { applied: false, reason: "execution_identity_conflict", lifecycle };
    }
  }

  if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current?.revision || 0)) {
    return { applied: false, reason: "turn_revision_conflict", currentRevision: Number(current?.revision || 0), lifecycle };
  }
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && lifecycle.activeTurnScopeId && lifecycle.activeTurnScopeId !== turnScopeId) {
    return { applied: false, reason: "session_action_conflict", lifecycle };
  }
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && requestedAction === "continue") {
    if (!requestedContinuationSource) {
      return { applied: false, reason: "continue_source_identity_incomplete", lifecycle };
    }
    const sourceTurn = lifecycle.turns[requestedContinuationSource.turnScopeId];
    if (
      !sourceTurn ||
      sourceTurn.dialogProcessId !== requestedContinuationSource.dialogProcessId ||
      sourceTurn.state !== TURN_STATE.STOP_COMPLETED ||
      sourceTurn.executionState !== "user_stopped"
    ) {
      return { applied: false, reason: "continue_source_not_stopped", lifecycle };
    }
    if (sourceTurn.continuedByTurnScopeId) {
      return { applied: false, reason: "continue_source_consumed", lifecycle };
    }
  } else if (eventType === TURN_EVENT.ACTION_ACCEPTED && requestedContinuationSource) {
    return { applied: false, reason: "unexpected_continuation_source", lifecycle };
  }
  if (eventType === TURN_EVENT.STOP_ACCEPTED && !deriveAuthoritativeTurnCapabilities(current || {}).canStop) {
    return { applied: false, reason: "stop_not_allowed", lifecycle };
  }
  if (!allowed(current, eventType)) return { applied: false, reason: "illegal_transition", lifecycle };

  const state = nextState(eventType, phase);
  if (!state) return { applied: false, reason: "invalid_failure_phase", lifecycle };
  const nowValue = now();
  const revision = Number(current?.revision || 0) + 1;
  const sequence = lifecycle.sequence + 1;
  const action = requestedAction;
  const isFinalizePending = eventType === TURN_EVENT.PROCESSING_COMPLETED || eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED;
  const isFinalizeFailure = eventType === TURN_EVENT.FAILED && (phase === TURN_PHASE.COMPLETION || phase === TURN_PHASE.STOP);
  const finalizeType = phase === TURN_PHASE.STOP || eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED ? "stop" : "completion";
  const finalizeIntent = isFinalizePending
    ? {
        type: finalizeType,
        commandId: clean(input.finalizeCommandId) || `${commandId}:finalize`,
        retryable: true,
        createdAt: clean(current?.finalizeIntent?.createdAt) || nowValue,
        updatedAt: nowValue,
        payload: input.finalizePayload && typeof input.finalizePayload === "object"
          ? input.finalizePayload
          : {},
      }
    : isFinalizeFailure && input.failure?.retryable === true
      ? {
          ...(current?.finalizeIntent || {}),
          type: clean(current?.finalizeIntent?.type) || finalizeType,
          commandId: clean(input.finalizeCommandId || current?.finalizeIntent?.commandId) || `${commandId}:retry`,
          retryable: true,
          createdAt: clean(current?.finalizeIntent?.createdAt) || nowValue,
          updatedAt: nowValue,
        }
      : eventType === TURN_EVENT.COMPLETED || eventType === TURN_EVENT.STOP_COMPLETED
        ? null
        : current?.finalizeIntent || null;
  const turn = {
    ...(current || {}),
    turnScopeId,
    messageId: requestedMessageId,
    presentationMessageId: requestedPresentationMessageId,
    ...requestedExecutionIdentity,
    dialogProcessId: clean(input.dialogProcessId || current?.dialogProcessId),
    commandId,
    action,
    state,
    phase,
    executionState: nextExecutionState(
      eventType,
      input.executionState || current?.executionState,
    ),
    revision,
    sequence,
    summaryVersion: integer(input.summaryVersion, integer(current?.summaryVersion)),
    completionCommitId: clean(input.completionCommitId || current?.completionCommitId),
    terminalStatus: input.terminalStatus && typeof input.terminalStatus === "object" && !Array.isArray(input.terminalStatus)
      ? { ...input.terminalStatus }
      : current?.terminalStatus || null,
    failure: eventType === TURN_EVENT.FAILED ? { ...(input.failure || {}), phase } : null,
    finalizeIntent,
    continuationSource: requestedContinuationSource,
    continuedByTurnScopeId: clean(current?.continuedByTurnScopeId),
    startedAt: clean(input.startedAt || current?.startedAt) || clean(current?.createdAt) || nowValue,
    finishedAt: TERMINAL_STATES.has(state)
      ? clean(input.finishedAt) || nowValue
      : clean(current?.finishedAt),
    createdAt: clean(current?.createdAt) || nowValue,
    updatedAt: nowValue,
  };
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && action === "continue") {
    lifecycle.turns[requestedContinuationSource.turnScopeId].continuedByTurnScopeId = turnScopeId;
  }
  lifecycle.turns[turnScopeId] = turn;
  lifecycle.sequence = sequence;
  lifecycle.activeTurnScopeId = TERMINAL_STATES.has(state) && !(FINALIZE_FAILURE_STATES.has(state) && finalizeIntent?.retryable === true)
    ? ""
    : turnScopeId;
  lifecycle.commandReceipts.push({
    commandId,
    eventType,
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

export function isTerminalTurnLifecycleState(state) {
  return TERMINAL_STATES.has(clean(state));
}

export function projectTurnLifecycleTiming(turn = {}, turnTimings = []) {
  const turnScopeId = clean(turn?.turnScopeId);
  const timing = turnScopeId
    ? (Array.isArray(turnTimings) ? turnTimings : []).find(
        (item) => clean(item?.turnScopeId) === turnScopeId,
      ) || null
    : null;
  const terminal = isTerminalTurnLifecycleState(turn?.state);
  return {
    ...turn,
    startedAt: clean(timing?.thinkingStartedAt || turn?.startedAt || turn?.createdAt),
    finishedAt: terminal
      ? clean(timing?.thinkingFinishedAt || turn?.finishedAt || turn?.updatedAt)
      : clean(turn?.finishedAt),
  };
}
