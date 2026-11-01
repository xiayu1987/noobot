/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTurnLifecycleRecordIntegrity,
  appendCommandReceipt,
  createTurnLifecycleEnvelope,
  createTurnTerminalStatus,
  deriveAuthoritativeTurnCapabilities,
  isSettlingTurnEvent,
  validateTurnLifecycleRequest,
} from "@noobot/session-protocol";
import { createTurnLifecycleEventEnvelope } from "@noobot/event-protocol";
import { transitionTurnLifecycle } from "../domain/turn-lifecycle-entity.js";
import { isCanonicalText } from "@noobot/shared/value";

export function createCommittedTurnLifecycleEnvelope({ event, turn, eventId, parentSessionId }) {
  const payload = createTurnLifecycleEnvelope({
    eventType: event.eventType,
    eventId,
    commandId: turn.commandId,
    causationId: event.causationId,
    correlationId: turn.turnScopeId,
    userId: event.userId,
    sessionId: event.sessionId,
    parentSessionId,
    turnScopeId: turn.turnScopeId,
    presentationMessageId: turn.presentationMessageId,
    dialogProcessId: turn.dialogProcessId,
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
    executionId: turn.executionId,
    executionKind: turn.executionKind,
    parentExecutionId: turn.parentExecutionId,
    rootExecutionId: turn.rootExecutionId,
    origin: turn.origin,
    stage: turn.stage,
    continuationSource: turn.continuationSource,
    continuedByTurnScopeId: turn.continuedByTurnScopeId,
  });
  return createTurnLifecycleEventEnvelope(payload, {
    producer: { type: "domain-service", id: "authoritative-turn-lifecycle" },
  });
}

export function commitTurnLifecycle({
  lifecycle,
  event = {},
  parentSessionId,
  isCommittedEventId,
  materializeTerminal,
  createEventId,
  now = () => new Date().toISOString(),
} = {}) {
  assertTurnLifecycleRecordIntegrity(lifecycle);
  const requestFailure = validateTurnLifecycleRequest(event);
  if (requestFailure) return { applied: false, reason: requestFailure, lifecycle };
  if (Object.hasOwn(event, "eventId") && !isCanonicalText(event.eventId))
    return { applied: false, reason: "invalid_event_id", lifecycle };
  let lifecycleEvent = event;
  let terminalMaterialization = null;
  const requestedTerminal =
    event.terminalStatus && typeof event.terminalStatus === "object" ? event.terminalStatus : null;
  const settling = isSettlingTurnEvent(event);
  if (settling && !requestedTerminal)
    return { applied: false, reason: "missing_turn_terminal_status", lifecycle };
  if (!settling && requestedTerminal)
    return { applied: false, reason: "unexpected_turn_terminal_status", lifecycle };

  if (requestedTerminal) {
    const settlingTurn = lifecycle.turns[event.turnScopeId];
    if (!settlingTurn) return { applied: false, reason: "turn_not_found", lifecycle };
    const { command, ...terminalPayload } = requestedTerminal;
    const terminalStatus = createTurnTerminalStatus(command, {
      ...terminalPayload,
      turnScopeId: event.turnScopeId,
      dialogProcessId: settlingTurn.dialogProcessId,
      updatedAt: event.finishedAt || now(),
    });
    if (!terminalStatus)
      return { applied: false, reason: "invalid_turn_terminal_status", lifecycle };
    lifecycleEvent = {
      ...event,
      summaryVersion: settlingTurn.summaryVersion + 1,
      terminalStatus,
    };
  }

  const transition = transitionTurnLifecycle(lifecycle, lifecycleEvent, now);
  if (!transition.applied) {
    const { receipt, ...rejection } = transition;
    return {
      ...rejection,
      ...(transition.deduplicated ? { envelope: receipt.envelope } : {}),
      committedEvent: null,
    };
  }

  if (requestedTerminal && typeof materializeTerminal !== "function") {
    return { applied: false, reason: "terminal_materializer_unavailable", lifecycle };
  }

  const { receiptDraft, ...applied } = transition;
  const turn = applied.turn;
  const eventId = Object.hasOwn(event, "eventId")
    ? event.eventId
    : typeof createEventId === "function"
      ? createEventId()
      : "";
  if (!isCanonicalText(eventId))
    return { applied: false, reason: "event_id_unavailable", lifecycle };
  if (typeof isCommittedEventId === "function" && isCommittedEventId(eventId) === true) {
    return { applied: false, reason: "event_id_conflict", lifecycle };
  }
  const envelope = createCommittedTurnLifecycleEnvelope({
    event: lifecycleEvent,
    turn,
    eventId,
    parentSessionId,
  });
  if (requestedTerminal) {
    const { terminalStatus, summaryVersion } = turn;
    terminalMaterialization = materializeTerminal({
      event,
      terminalStatus,
      previousSummaryVersion: lifecycle.turns[event.turnScopeId].summaryVersion,
    });
    if (
      !terminalMaterialization?.materialized ||
      terminalMaterialization.terminalStatus !== terminalStatus ||
      !Array.isArray(terminalMaterialization.messages) ||
      terminalMaterialization.summaryVersion !== summaryVersion
    ) {
      return {
        applied: false,
        reason: terminalMaterialization?.reason || "terminal_materialization_failed",
        lifecycle,
      };
    }
  }
  applied.lifecycle.commandReceipts = appendCommandReceipt(applied.lifecycle.commandReceipts, {
    ...receiptDraft,
    eventId,
    envelope,
  });
  return {
    ...applied,
    envelope,
    committedEvent: { eventId, envelope, committedAt: turn.updatedAt },
    terminalMaterialization,
  };
}
