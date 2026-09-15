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

function resolveLifecycleSessionIds({ activeSession, data, event, sessionId }) {
  const childSessionId =
    event === StreamEventEnum.TURN_LIFECYCLE ? normalizeTrimmedString(data?.sessionId) : "";
  const rootSessionId = normalizeTrimmedString(
    data?.parentSessionId || activeSession?.value?.sessionId || sessionId,
  );
  return { childSessionId, rootSessionId };
}

function buildStreamEventLogData({ authoritativeEvent, data, event, childSessionId }) {
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
    messageId: str(identity.messageId),
    presentationMessageId: str(payload.presentationMessageId),
    sequence: num(ordering.sequence),
    sequenceDomain: str(ordering.domain),
    sequenceScopeId: str(ordering.scopeId),
    textLength: str(payload.text).length,
    childSessionId,
    parentSessionId: str(eventData.parentSessionId),
    lifecycleEventType: str(eventData.eventType),
    lifecycleRevision: num(eventData.revision),
    lifecycleSequence: num(eventData.sequence),
    lifecyclePersistenceScopeId: str(persistenceScope.scopeId),
  };
}

export function buildStreamEventLogEntry({
  activeSession,
  authoritativeEvent,
  botMsg,
  data,
  event,
  sessionId,
  turnScopeId,
}) {
  const identity = authoritativeEvent?.identity || {};
  const payload = authoritativeEvent?.payload || {};
  const { childSessionId, rootSessionId } = resolveLifecycleSessionIds({
    activeSession,
    data,
    event,
    sessionId,
  });
  return {
    category: event === StreamEventEnum.INTERACTION_REQUEST ? "interaction" : "transport",
    event: `stream.${event || "event"}`,
    sessionId:
      childSessionId && childSessionId !== rootSessionId
        ? rootSessionId
        : identity.sessionId || data?.sessionId || sessionId,
    dialogProcessId:
      payload.dialogProcessId ||
      data?.dialogProcessId ||
      normalizeTrimmedString(botMsg?.dialogProcessId),
    turnScopeId: identity.turnScopeId || data?.turnScopeId || turnScopeId,
    data: buildStreamEventLogData({ authoritativeEvent, data, event, childSessionId }),
  };
}
