/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { normalizeTrimmedString } from "./utils.js";

function orDefault(value, fallback) {
  return value || fallback;
}

function str(value) {
  return String(value || "");
}

function num(value) {
  return Number(value || 0);
}

function buildStreamEventLogData({ authoritativeEvent, data, event }) {
  const source = authoritativeEvent || {};
  const identity = orDefault(source.identity, {});
  const ordering = orDefault(source.ordering, {});
  const payload = orDefault(source.payload, {});
  const protocol = orDefault(source.protocol, {});
  const eventData = orDefault(data, {});
  const eventPayload = orDefault(eventData.payload, {});
  const persistenceScope = orDefault(eventData.persistenceScope, {});
  return {
    streamEvent: event,
    state: orDefault(eventData.state, ""),
    seq: orDefault(eventData.seq, 0),
    hasContent: typeof eventPayload.text === "string",
    protocolName: str(protocol.name),
    protocolVersion: num(protocol.version),
    eventFamily: str(protocol.family),
    schemaVersion: num(protocol.schemaVersion),
    eventId: str(identity.eventId),
    eventType: str(identity.eventType),
    presentationMessageId: str(payload.presentationMessageId),
    sequence: num(ordering.sequence),
    sequenceDomain: str(ordering.domain),
    sequenceScopeId: str(ordering.scopeId),
    textLength: str(payload.text).length,
    childSessionId:
      event === StreamEventEnum.TURN_LIFECYCLE ? normalizeTrimmedString(eventData.sessionId) : "",
    eventSessionId: str(eventData.sessionId),
    eventDialogProcessId: str(eventData.dialogProcessId),
    eventTurnScopeId: str(eventData.turnScopeId),
    parentSessionId: str(eventData.parentSessionId),
    lifecycleEventType: str(eventData.eventType),
    lifecycleRevision: num(eventData.revision),
    lifecycleSequence: num(eventData.sequence),
    lifecyclePersistenceScopeId: str(persistenceScope.scopeId),
  };
}

function resolveStreamEventLogIdentity({ authoritativeEvent, botMsg, sessionId, turnScopeId }) {
  if (authoritativeEvent) {
    return {
      sessionId: str(authoritativeEvent.identity.sessionId),
      dialogProcessId: str(authoritativeEvent.payload?.dialogProcessId),
      turnScopeId: str(authoritativeEvent.identity.turnScopeId),
    };
  }
  return {
    sessionId: str(sessionId),
    dialogProcessId: normalizeTrimmedString(botMsg?.dialogProcessId),
    turnScopeId: str(turnScopeId),
  };
}

export function buildStreamEventLogEntry({
  authoritativeEvent,
  botMsg,
  data,
  event,
  sessionId,
  turnScopeId,
}) {
  return {
    category: event === StreamEventEnum.INTERACTION_REQUEST ? "interaction" : "transport",
    event: `stream.${event || "event"}`,
    ...resolveStreamEventLogIdentity({ authoritativeEvent, botMsg, sessionId, turnScopeId }),
    data: buildStreamEventLogData({ authoritativeEvent, data, event }),
  };
}
