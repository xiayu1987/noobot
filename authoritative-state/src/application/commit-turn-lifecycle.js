/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnLifecycleEnvelope,
  createTurnTerminalStatus,
  deriveAuthoritativeTurnCapabilities,
} from "@noobot/session-protocol";
import { normalizeAuthorityEventOutbox } from "@noobot/event-protocol/outbox";
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
  event = {},
  eventOutbox = [],
  materializeTerminal,
  createEventId,
  now = () => new Date().toISOString(),
} = {}) {
  const normalizedOutbox = normalizeAuthorityEventOutbox(eventOutbox);
  let lifecycleEvent = event;
  let terminalMaterialization = null;
  const requestedTerminal =
    event.terminalStatus && typeof event.terminalStatus === "object" ? event.terminalStatus : null;

  if (requestedTerminal) {
    const terminalStatus = createTurnTerminalStatus(requestedTerminal.command, {
      ...requestedTerminal,
      turnScopeId: event.turnScopeId,
      dialogProcessId: event.dialogProcessId,
      updatedAt: clean(event.finishedAt) || now(),
    });
    if (!terminalStatus)
      return { applied: false, reason: "invalid_turn_terminal_status", lifecycle };
    if (typeof materializeTerminal !== "function") {
      return { applied: false, reason: "terminal_materializer_unavailable", lifecycle };
    }
    terminalMaterialization = materializeTerminal({
      event,
      terminalStatus,
      previousSummaryVersion: Number(lifecycle?.turns?.[event.turnScopeId]?.summaryVersion || 0),
    });
    if (
      !terminalMaterialization?.materialized ||
      terminalMaterialization.terminalStatus !== terminalStatus ||
      !Array.isArray(terminalMaterialization.messages) ||
      !Number.isInteger(Number(terminalMaterialization.summaryVersion)) ||
      Number(terminalMaterialization.summaryVersion) < 1
    ) {
      return {
        applied: false,
        reason: terminalMaterialization?.reason || "terminal_materialization_failed",
        lifecycle,
      };
    }
    lifecycleEvent = {
      ...event,
      summaryVersion: Number(terminalMaterialization.summaryVersion),
      completionCommitId: clean(event.completionCommitId || event.commandId),
      terminalStatus,
    };
  }

  const transition = transitionTurnLifecycle(lifecycle, lifecycleEvent, now);
  if (!transition.applied) {
    const receiptEnvelope = transition.deduplicated
      ? transition.lifecycle.commandReceipts.find(
          (receipt) =>
            receipt.commandId === clean(event.commandId) && receipt.type === clean(event.eventType),
        )?.envelope || null
      : null;
    return { ...transition, envelope: receiptEnvelope, eventOutbox: normalizedOutbox };
  }

  const turn = transition.turn;
  if (isTerminalTurnLifecycleState(turn.state)) {
    turn.terminalStatus = turn.terminalStatus || {
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
      status: turn.state,
      error: turn.failure || null,
      updatedAt: turn.updatedAt,
    };
  }
  const eventId =
    clean(event.eventId) || clean(typeof createEventId === "function" ? createEventId() : "");
  if (!eventId) return { applied: false, reason: "event_id_unavailable", lifecycle };
  if (normalizedOutbox.some((item) => item.eventId === eventId)) {
    return { applied: false, reason: "event_id_conflict", lifecycle };
  }
  const envelope = createCommittedTurnLifecycleEnvelope({ event: lifecycleEvent, turn, eventId });
  const receipt = transition.lifecycle.commandReceipts.find(
    (item) => item.commandId === clean(event.commandId) && item.type === clean(event.eventType),
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
    terminalMaterialization,
  };
}
