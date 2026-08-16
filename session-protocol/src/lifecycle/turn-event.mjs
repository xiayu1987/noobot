/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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

const clean = (value) => String(value || "").trim();

/**
 * Derives the globally unique identity of one lifecycle transition from the
 * owning transport/domain command. A command may produce several lifecycle
 * facts, therefore its raw commandId must never be reused as a transition id.
 */
export function createTurnLifecycleCommandId({ commandId, eventType, phase = "" } = {}) {
  const rootCommandId = clean(commandId);
  const lifecycleEventType = clean(eventType);
  const lifecyclePhase = clean(phase);
  if (!rootCommandId || !TURN_EVENT_VALUES.includes(lifecycleEventType)) return "";
  return [rootCommandId, lifecycleEventType, lifecycleEventType === TURN_EVENT.FAILED ? lifecyclePhase : ""]
    .filter(Boolean)
    .join(":");
}
