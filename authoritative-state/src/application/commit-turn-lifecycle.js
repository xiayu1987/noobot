/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnLifecycleEnvelope,
  deriveAuthoritativeTurnCapabilities,
} from "@noobot/session-protocol/turn-lifecycle";
import {
  findAuthorityEventEnvelope,
  normalizeAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";
import {
  isTerminalTurnLifecycleState,
  transitionTurnLifecycle,
} from "../domain/turn-lifecycle-entity.js";

const clean = (value) => String(value || "").trim();

export function createCommittedTurnLifecycleEnvelope({ event = {}, turn = {}, eventId = "" } = {}) {
  return createTurnLifecycleEnvelope({
    eventType: event.eventType,
    eventId: clean(eventId || event.eventId),
    commandId: event.commandId || turn.commandId,
    causationId: event.causationId || event.commandId || turn.commandId,
    correlationId: event.correlationId || event.turnScopeId || turn.turnScopeId,
    userId: event.userId,
    sessionId: event.sessionId,
    parentSessionId: event.parentSessionId || turn.parentSessionId,
    turnScopeId: event.turnScopeId || turn.turnScopeId,
    messageId: turn.messageId,
    presentationMessageId: turn.presentationMessageId,
    dialogProcessId: turn.dialogProcessId || event.dialogProcessId,
    revision: turn.revision,
    sequence: turn.sequence,
    phase: turn.phase,
    state: turn.state,
    action: turn.action,
    executionState: turn.executionState,
    summaryVersion: turn.summaryVersion,
    completionCommitId: turn.completionCommitId,
    startedAt: turn.startedAt,
    finishedAt: turn.finishedAt,
    updatedAt: turn.updatedAt,
    occurredAt: turn.updatedAt,
    capabilities: deriveAuthoritativeTurnCapabilities(turn),
    failure: turn.failure,
    payload: event.payload,
    executionId: event.executionId || turn.executionId,
    executionKind: event.executionKind || turn.executionKind,
    parentExecutionId: event.parentExecutionId || turn.parentExecutionId,
    rootExecutionId: event.rootExecutionId || turn.rootExecutionId,
    origin: event.origin || turn.origin,
    stage: event.stage || turn.stage,
    continuationSource: turn.continuationSource,
    continuedByTurnScopeId: turn.continuedByTurnScopeId,
  });
}

/**
 * Computes one authoritative commit. The caller owns the storage transaction and
 * must persist lifecycle, terminal materialization and eventOutbox together.
 */
export function commitTurnLifecycle({
  lifecycle = {},
  terminalMaterialization = null,
  event = {},
  eventOutbox = [],
  materializeTerminal,
  createEventId,
  now = () => new Date().toISOString(),
} = {}) {
  const normalizedOutbox = normalizeAuthorityEventOutbox(eventOutbox);
  let materialization = null;
  let lifecycleEvent = event;
  const requestedTerminal = event.terminalStatus && typeof event.terminalStatus === "object"
    ? event.terminalStatus
    : null;

  if (requestedTerminal) {
    if (typeof materializeTerminal !== "function") {
      return { applied: false, reason: "terminal_materializer_unavailable", lifecycle };
    }
    const result = materializeTerminal({ terminalStatus: requestedTerminal, event });
    if (!result?.turnStatus) {
      return { applied: false, reason: result?.reason || "invalid_turn_status", lifecycle };
    }
    materialization = result;
    lifecycleEvent = {
      ...event,
      summaryVersion: Number(event.summaryVersion || result.summaryVersion || 0),
      completionCommitId: clean(event.completionCommitId || event.commandId),
      terminalStatus: result.turnStatus,
    };
  }

  const transition = transitionTurnLifecycle(lifecycle, lifecycleEvent, now);
  if (!transition.applied) {
    const receiptEnvelope = transition.deduplicated
      ? transition.lifecycle.commandReceipts.find((receipt) =>
          receipt.commandId === clean(event.commandId) && receipt.eventType === clean(event.eventType),
        )?.envelope || null
      : null;
    // The Outbox lookup is retained only for sessions written before durable
    // receipt results were introduced.
    const existingEnvelope = receiptEnvelope || (transition.deduplicated
      ? findAuthorityEventEnvelope(normalizedOutbox, event)
      : null);
    return { ...transition, envelope: existingEnvelope, eventOutbox: normalizedOutbox };
  }

  const turn = transition.turn;
  if (isTerminalTurnLifecycleState(turn.state)) {
    turn.terminalStatus = materialization?.turnStatus || turn.terminalStatus || {
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
      status: turn.state,
      error: turn.failure || null,
      updatedAt: turn.updatedAt,
    };
  }
  const eventId = clean(event.eventId) || clean(typeof createEventId === "function" ? createEventId() : "");
  if (!eventId) return { applied: false, reason: "event_id_unavailable", lifecycle };
  if (normalizedOutbox.some((item) => item.eventId === eventId)) {
    return { applied: false, reason: "event_id_conflict", lifecycle };
  }
  const envelope = createCommittedTurnLifecycleEnvelope({ event: lifecycleEvent, turn, eventId });
  const receipt = transition.lifecycle.commandReceipts.find((item) =>
    item.commandId === clean(event.commandId) && item.eventType === clean(event.eventType),
  );
  if (!receipt) return { applied: false, reason: "command_receipt_unavailable", lifecycle };
  receipt.eventId = eventId;
  receipt.envelope = envelope;
  const nextOutbox = normalizeAuthorityEventOutbox([
    ...normalizedOutbox,
    { eventId, envelope, committedAt: turn.updatedAt },
  ]);
  return {
    ...transition,
    envelope,
    eventOutbox: nextOutbox,
    terminalMaterialization: materialization,
  };
}
