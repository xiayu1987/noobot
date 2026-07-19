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
} from "@noobot/shared/turn-lifecycle-protocol";

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
      dialogProcessId: clean(value.dialogProcessId),
      commandId: clean(value.commandId),
      action: clean(value.action),
      state: clean(value.state),
      phase: clean(value.phase),
      executionState: clean(value.executionState).toLowerCase(),
      revision: integer(value.revision),
      sequence: integer(value.sequence),
      summaryVersion: integer(value.summaryVersion),
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
          }
        : null,
      createdAt: clean(value.createdAt),
      updatedAt: clean(value.updatedAt),
    };
  }
  const commandReceipts = (Array.isArray(source?.commandReceipts) ? source.commandReceipts : [])
    .filter((item) => item && typeof item === "object" && clean(item.commandId))
    .map((item) => ({
      commandId: clean(item.commandId),
      eventType: clean(item.eventType),
      turnScopeId: clean(item.turnScopeId),
      requestHash: clean(item.requestHash),
      revision: integer(item.revision),
      sequence: integer(item.sequence),
      committedAt: clean(item.committedAt),
    }))
    .slice(-200);
  const activeTurnScopeId = clean(source?.activeTurnScopeId);
  return {
    activeTurnScopeId: turns[activeTurnScopeId] && (
      !TERMINAL_STATES.has(turns[activeTurnScopeId].state) ||
      (FINALIZE_FAILURE_STATES.has(turns[activeTurnScopeId].state) && turns[activeTurnScopeId].finalizeIntent?.retryable === true)
    )
      ? activeTurnScopeId
      : "",
    sequence: Math.max(integer(source?.sequence), ...Object.values(turns).map((turn) => turn.sequence)),
    turns,
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

  const requestHash = JSON.stringify({ eventType, turnScopeId, phase, action: clean(input.action), executionState: clean(input.executionState) });
  const receipt = lifecycle.commandReceipts.find((item) => item.commandId === commandId && item.eventType === eventType);
  if (receipt) {
    if (receipt.requestHash !== requestHash) return { applied: false, reason: "idempotency_key_reused", lifecycle };
    return { applied: false, deduplicated: true, reason: "duplicate_command", lifecycle, turn: lifecycle.turns[receipt.turnScopeId] };
  }

  const current = lifecycle.turns[turnScopeId] || null;
  if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(current?.revision || 0)) {
    return { applied: false, reason: "turn_revision_conflict", currentRevision: Number(current?.revision || 0), lifecycle };
  }
  if (eventType === TURN_EVENT.ACTION_ACCEPTED && lifecycle.activeTurnScopeId && lifecycle.activeTurnScopeId !== turnScopeId) {
    return { applied: false, reason: "session_action_conflict", lifecycle };
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
  const action = eventType === TURN_EVENT.STOP_ACCEPTED ? "stop" : clean(input.action || current?.action);
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
    dialogProcessId: clean(input.dialogProcessId || current?.dialogProcessId),
    commandId,
    action,
    state,
    phase,
    executionState: clean(input.executionState || current?.executionState).toLowerCase(),
    revision,
    sequence,
    summaryVersion: integer(input.summaryVersion, integer(current?.summaryVersion)),
    failure: eventType === TURN_EVENT.FAILED ? { ...(input.failure || {}), phase } : null,
    finalizeIntent,
    createdAt: clean(current?.createdAt) || nowValue,
    updatedAt: nowValue,
  };
  lifecycle.turns[turnScopeId] = turn;
  lifecycle.sequence = sequence;
  lifecycle.activeTurnScopeId = TERMINAL_STATES.has(state) && !(FINALIZE_FAILURE_STATES.has(state) && finalizeIntent?.retryable === true)
    ? ""
    : turnScopeId;
  lifecycle.commandReceipts.push({ commandId, eventType, turnScopeId, requestHash, revision, sequence, committedAt: nowValue });
  lifecycle.commandReceipts = lifecycle.commandReceipts.slice(-200);
  return { applied: true, lifecycle, turn };
}

export function isTerminalTurnLifecycleState(state) {
  return TERMINAL_STATES.has(clean(state));
}
