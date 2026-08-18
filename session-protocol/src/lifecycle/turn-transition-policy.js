/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deriveAuthoritativeTurnCapabilities } from "./turn-capability.js";
import { TURN_EVENT } from "./turn-event.js";
import { isTerminalTurnState, TURN_PHASE, TURN_STATE } from "./turn-state.js";

const EVENT_STATE = Object.freeze({
  [TURN_EVENT.ACTION_ACCEPTED]: TURN_STATE.ACTION_REQUESTING,
  [TURN_EVENT.PROCESSING_STARTED]: TURN_STATE.PROCESSING,
  [TURN_EVENT.PROCESSING_COMPLETED]: TURN_STATE.COMPLETION_REQUESTING,
  [TURN_EVENT.STOP_ACCEPTED]: TURN_STATE.ACTION_REQUESTING,
  [TURN_EVENT.STOP_PROCESSING_COMPLETED]: TURN_STATE.STOPPING,
  [TURN_EVENT.COMPLETED]: TURN_STATE.COMPLETED,
  [TURN_EVENT.STOP_COMPLETED]: TURN_STATE.STOP_COMPLETED,
});

const FAILED_PHASE_STATE = Object.freeze({
  [TURN_PHASE.ACTION]: TURN_STATE.ACTION_FAILED,
  [TURN_PHASE.PROCESSING]: TURN_STATE.PROCESSING_FAILED,
  [TURN_PHASE.COMPLETION]: TURN_STATE.COMPLETION_FAILED,
  [TURN_PHASE.STOP]: TURN_STATE.STOP_FAILED,
});

export function deriveTurnState(eventType = "", phase = "") {
  return eventType === TURN_EVENT.FAILED
    ? FAILED_PHASE_STATE[phase] || ""
    : EVENT_STATE[eventType] || "";
}

export function deriveTurnEventType(state = "", { action = "" } = {}) {
  const normalizedState = String(state || "").trim();
  if (normalizedState === TURN_STATE.ACTION_REQUESTING) {
    return String(action || "").trim() === "stop"
      ? TURN_EVENT.STOP_ACCEPTED
      : TURN_EVENT.ACTION_ACCEPTED;
  }
  if (normalizedState === TURN_STATE.PROCESSING) return TURN_EVENT.PROCESSING_STARTED;
  if (normalizedState === TURN_STATE.COMPLETION_REQUESTING) {
    return TURN_EVENT.PROCESSING_COMPLETED;
  }
  if (normalizedState === TURN_STATE.STOPPING) return TURN_EVENT.STOP_PROCESSING_COMPLETED;
  if (normalizedState === TURN_STATE.COMPLETED) return TURN_EVENT.COMPLETED;
  if (normalizedState === TURN_STATE.STOP_COMPLETED) return TURN_EVENT.STOP_COMPLETED;
  if (Object.values(FAILED_PHASE_STATE).includes(normalizedState)) return TURN_EVENT.FAILED;
  return "";
}

export function deriveTurnExecutionState(eventType = "", current = "") {
  if (eventType === TURN_EVENT.COMPLETED) return "completed";
  if (eventType === TURN_EVENT.STOP_COMPLETED) return "user_stopped";
  if (eventType === TURN_EVENT.FAILED) return "error";
  return String(current || "")
    .trim()
    .toLowerCase();
}

export function decideTurnTransition({ current = null, eventType = "", phase = "" } = {}) {
  const nextState = deriveTurnState(eventType, phase);
  if (!nextState) return Object.freeze({ allowed: false, reason: "invalid_failure_phase" });
  if (!current)
    return Object.freeze({
      allowed: eventType === TURN_EVENT.ACTION_ACCEPTED,
      nextState,
      reason: eventType === TURN_EVENT.ACTION_ACCEPTED ? "" : "illegal_transition",
    });
  let allowed = false;
  if (eventType === TURN_EVENT.PROCESSING_STARTED)
    allowed = current.state === TURN_STATE.ACTION_REQUESTING && current.action !== "stop";
  else if (eventType === TURN_EVENT.PROCESSING_COMPLETED)
    allowed = current.state === TURN_STATE.PROCESSING;
  else if (eventType === TURN_EVENT.STOP_ACCEPTED)
    allowed = deriveAuthoritativeTurnCapabilities(current).canStop;
  else if (eventType === TURN_EVENT.STOP_PROCESSING_COMPLETED)
    allowed = current.state === TURN_STATE.ACTION_REQUESTING && current.action === "stop";
  else if (eventType === TURN_EVENT.COMPLETED)
    allowed =
      current.state === TURN_STATE.COMPLETION_REQUESTING ||
      (current.state === TURN_STATE.COMPLETION_FAILED &&
        current.finalizeIntent?.retryable === true);
  else if (eventType === TURN_EVENT.STOP_COMPLETED)
    allowed =
      current.state === TURN_STATE.STOPPING ||
      (current.state === TURN_STATE.STOP_FAILED && current.finalizeIntent?.retryable === true);
  else if (eventType === TURN_EVENT.FAILED) allowed = !isTerminalTurnState(current.state);
  return Object.freeze({ allowed, nextState, reason: allowed ? "" : "illegal_transition" });
}

export const TURN_EVENT_STATE = EVENT_STATE;
export const TURN_FAILED_PHASE_STATE = FAILED_PHASE_STATE;
