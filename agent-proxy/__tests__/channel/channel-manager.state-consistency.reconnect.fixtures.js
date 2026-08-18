/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnLifecycleEnvelope,
  createTurnLifecycleSnapshot,
  TURN_EVENT,
} from "@noobot/session-protocol";
import {
  createEventEnvelope,
  createTurnSnapshotEnvelope,
  EVENT_FAMILY,
} from "@noobot/event-protocol";

export function authoritativeSnapshot(fields = {}) {
  return createTurnSnapshotEnvelope(createTurnLifecycleSnapshot({
    generatedAt: "2026-08-17T00:00:00.000Z",
    recentTerminalTurns: [],
    replacedTurns: [],
    ...fields,
  }), {
    eventId: fields.eventId || `${fields.commandId}:snapshot:${fields.sequence || 0}`,
    producer: { type: "test", id: "agent-proxy-reconnect-fixture" },
  });
}

export function authoritativeLifecycle(fields = {}) {
  const eventType = String(fields.eventType || "").trim();
  const stateByEvent = {
    [TURN_EVENT.ACTION_ACCEPTED]: "action_requesting",
    [TURN_EVENT.PROCESSING_STARTED]: "processing",
    [TURN_EVENT.PROCESSING_COMPLETED]: "completion_requesting",
    [TURN_EVENT.STOP_ACCEPTED]: "action_requesting",
    [TURN_EVENT.STOP_PROCESSING_COMPLETED]: "stopping",
    [TURN_EVENT.COMPLETED]: "completed",
    [TURN_EVENT.STOP_COMPLETED]: "stop_completed",
  };
  const phaseByEvent = {
    [TURN_EVENT.ACTION_ACCEPTED]: "action",
    [TURN_EVENT.PROCESSING_STARTED]: "processing",
    [TURN_EVENT.PROCESSING_COMPLETED]: "completion",
    [TURN_EVENT.STOP_ACCEPTED]: "stop",
    [TURN_EVENT.STOP_PROCESSING_COMPLETED]: "stop",
    [TURN_EVENT.COMPLETED]: "completion",
    [TURN_EVENT.STOP_COMPLETED]: "stop",
  };
  const terminal = eventType === TURN_EVENT.COMPLETED || eventType === TURN_EVENT.STOP_COMPLETED;
  const payload = createTurnLifecycleEnvelope({
    eventType,
    eventId: fields.eventId,
    commandId: fields.commandId || `command-${fields.eventId}`,
    userId: fields.userId || "user-1",
    sessionId: fields.sessionId,
    parentSessionId: fields.parentSessionId,
    turnScopeId: fields.turnScopeId,
    messageId: fields.messageId || `message-${fields.eventId}`,
    presentationMessageId: fields.presentationMessageId || `presentation-${fields.eventId}`,
    dialogProcessId: fields.dialogProcessId || `dialog-${fields.eventId}`,
    revision: fields.revision,
    sequence: fields.sequence,
    phase: fields.phase || phaseByEvent[eventType],
    state: fields.state || stateByEvent[eventType],
    executionState: fields.executionState || (terminal ? "completed" : "sending"),
    summaryVersion: terminal ? 1 : 0,
    completionCommitId: terminal ? `commit-${fields.eventId}` : "",
    ...fields,
  });
  return createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    identity: {
      eventId: payload.eventId,
      eventType: "turn_lifecycle",
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      messageId: payload.messageId,
    },
    causality: { commandId: payload.commandId },
    ordering: {
      domain: "session",
      scopeId: payload.sessionId,
      sequence: payload.sequence,
      revision: payload.revision,
    },
    producer: { type: "test", id: "agent-proxy-reconnect-fixture" },
    occurredAt: payload.occurredAt,
    payload,
  });
}
