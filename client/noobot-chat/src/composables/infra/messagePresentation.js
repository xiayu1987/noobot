/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const STATUS_STEP_DISPLAY_STATES = new Set([
  "completed",
  "stopped",
  "error",
  "requesting",
  "sending",
  "completing",
  "stopping",
]);

const TERMINAL_STATUS_STEP_DISPLAY_STATES = new Set([
  "completed",
  "stopped",
  "error",
]);

function text(value = "") {
  return String(value || "").trim();
}

export function normalizeStatusStepDisplayState(value = "") {
  const normalized = text(value).toLowerCase();
  return STATUS_STEP_DISPLAY_STATES.has(normalized) ? normalized : "";
}

function statusStepDisplayStateFromPersisted(value = "") {
  const normalized = text(value).toLowerCase();
  if (["user_stopped", "stopped"].includes(normalized)) return "stopped";
  if (["error", "failed", "expired"].includes(normalized)) return "error";
  return ["requesting", "sending", "completing", "stopping"].includes(normalized)
    ? normalized
    : "";
}

/**
 * Resolve status-step presentation without mutating Turn Runtime authority.
 * Runtime terminals win, an active Runtime wins over a stale child projection,
 * and persisted status is fallback-only when no Runtime has been hydrated.
 */
export function resolveStatusStepPresentation({
  turnRuntime = null,
  runtimeDisplayState = "",
  projectedState = "",
  persistedState = "",
} = {}) {
  const projectedDisplayState = normalizeStatusStepDisplayState(projectedState);
  if (turnRuntime) {
    if (turnRuntime.terminal === "completed") {
      return { displayState: "completed", source: "turn-runtime-terminal" };
    }
    if (turnRuntime.terminal === "user_stopped") {
      return { displayState: "stopped", source: "turn-runtime-terminal" };
    }
    if (turnRuntime.terminal) {
      return { displayState: "error", source: "turn-runtime-terminal" };
    }
    const runtimeState = normalizeStatusStepDisplayState(runtimeDisplayState);
    if (runtimeState && !TERMINAL_STATUS_STEP_DISPLAY_STATES.has(runtimeState)) {
      return { displayState: runtimeState, source: "turn-runtime-active" };
    }
    return projectedDisplayState
      ? { displayState: projectedDisplayState, source: "child-execution-projection" }
      : { displayState: "", source: "" };
  }
  if (projectedDisplayState) {
    return { displayState: projectedDisplayState, source: "child-execution-projection" };
  }
  const persistedDisplayState = statusStepDisplayStateFromPersisted(persistedState);
  return persistedDisplayState
    ? { displayState: persistedDisplayState, source: "persisted-fallback" }
    : { displayState: "", source: "" };
}

function mergeProjectedStatusStepState(previousState = "", currentState = "") {
  const previous = normalizeStatusStepDisplayState(previousState);
  const current = normalizeStatusStepDisplayState(currentState);
  if (!current) return previous;
  if (!previous) return current;
  if (TERMINAL_STATUS_STEP_DISPLAY_STATES.has(previous) &&
      !TERMINAL_STATUS_STEP_DISPLAY_STATES.has(current)) {
    return previous;
  }
  return current;
}

/** Reduce the status-step facet of two already identity-compatible messages. */
export function mergeMessagePresentationFacets(previousMessage = {}, currentMessage = {}) {
  const previousScopeId = text(previousMessage?.statusTurnScopeId);
  const currentScopeId = text(currentMessage?.statusTurnScopeId);
  if (previousScopeId && currentScopeId && previousScopeId !== currentScopeId) {
    return {
      statusTurnScopeId: previousScopeId,
      projectedStatusStepState: normalizeStatusStepDisplayState(
        previousMessage?.projectedStatusStepState,
      ),
    };
  }
  return {
    statusTurnScopeId: previousScopeId || currentScopeId,
    projectedStatusStepState: mergeProjectedStatusStepState(
      previousMessage?.projectedStatusStepState,
      currentMessage?.projectedStatusStepState,
    ),
  };
}

