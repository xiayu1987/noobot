/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";
import { TURN_PHASE } from "./turn-state.js";

export const TURN_COMMAND = Object.freeze({
  SEND: "turn.send",
  RESEND: "turn.resend",
  CONTINUE: "turn.continue",
  STOP: "turn.stop",
  FINALIZE: "turn.finalize",
  SNAPSHOT_GET: "turn.snapshot.get",
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

export const TURN_EVENT_VALUES = Object.freeze(Object.values(TURN_EVENT));

export const TURN_TERMINAL_EVENTS = Object.freeze([
  TURN_EVENT.COMPLETED,
  TURN_EVENT.STOP_COMPLETED,
  TURN_EVENT.FAILED,
]);

const terminalEvents = new Set(TURN_TERMINAL_EVENTS);

export function isTerminalTurnEvent(eventType = "") {
  return terminalEvents.has(clean(eventType));
}

const finalizePhases = new Set([TURN_PHASE.COMPLETION, TURN_PHASE.STOP]);

export function isRetryableFinalizeFailureEvent(event = {}) {
  return (
    clean(event?.eventType) === TURN_EVENT.FAILED &&
    finalizePhases.has(clean(event?.phase)) &&
    event?.failure?.retryable === true
  );
}

export function isSettlingTurnEvent(event = {}) {
  return isTerminalTurnEvent(event?.eventType) && !isRetryableFinalizeFailureEvent(event);
}

const finalizeRequestEvents = new Set([
  TURN_EVENT.PROCESSING_COMPLETED,
  TURN_EVENT.STOP_PROCESSING_COMPLETED,
]);

export function isFinalizeRequestTurnEvent(eventType = "") {
  return finalizeRequestEvents.has(clean(eventType));
}

const completionCommitEvents = new Set([TURN_EVENT.COMPLETED, TURN_EVENT.STOP_COMPLETED]);

export function isCompletionCommitTurnEvent(eventType = "") {
  return completionCommitEvents.has(clean(eventType));
}

export function createTurnLifecycleCommandId({ commandId, eventType, phase = "" } = {}) {
  const rootCommandId = clean(commandId);
  const lifecycleEventType = clean(eventType);
  const lifecyclePhase = clean(phase);
  if (!rootCommandId || !TURN_EVENT_VALUES.includes(lifecycleEventType)) return "";
  return [
    rootCommandId,
    lifecycleEventType,
    lifecycleEventType === TURN_EVENT.FAILED ? lifecyclePhase : "",
  ]
    .filter(Boolean)
    .join(":");
}
