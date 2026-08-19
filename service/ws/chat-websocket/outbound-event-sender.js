/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateProtocolEvent } from "@noobot/event-protocol";
import { usesExactAgentTransportPayload } from "@noobot/agent-transport-protocol";
import { TURN_EVENT, TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";
import { recordServiceWebSocketSendFailure } from "./runtime-events.js";

function text(value) {
  return String(value || "").trim();
}

function getProtocolEnvelope(data) {
  return data?.protocol?.name === "@noobot/event-protocol" ? data : null;
}

function validateOutboundProtocolEnvelope(protocolEnvelope, eventName, logConnection) {
  if (!protocolEnvelope) return true;
  const validation = validateProtocolEvent(protocolEnvelope);
  if (!validation.valid) {
    logConnection("service.authorityOutbox.eventRejected", {
      eventId: text(protocolEnvelope?.identity?.eventId),
      eventType: text(protocolEnvelope?.identity?.eventType),
      errors: validation.errors,
    });
    return false;
  }
  if (protocolEnvelope.identity.eventType === eventName) return true;
  logConnection("service.authorityOutbox.eventRejected", {
    eventId: text(protocolEnvelope.identity.eventId),
    eventType: text(protocolEnvelope.identity.eventType),
    errors: ["transport_event_type_mismatch"],
  });
  return false;
}

function getAuthoritativeMessageEvent(data) {
  return data?.channelKind === "message_event" && data?.event && typeof data.event === "object"
    ? data.event
    : null;
}

function resolveEventType(protocolEnvelope, authoritativeEvent, data) {
  return text(
    protocolEnvelope?.payload?.eventType ||
      authoritativeEvent?.eventType ||
      data?.eventType ||
      data?.messageEvent?.eventType,
  );
}

function createTransportDiagnostic({
  protocolEnvelope,
  authoritativeEvent,
  data,
  eventType,
  transportContext,
  webSocket,
}) {
  return {
    eventId: text(
      protocolEnvelope?.identity?.eventId || authoritativeEvent?.eventId || data?.eventId,
    ),
    eventType,
    messageId: text(authoritativeEvent?.messageId || data?.messageId),
    presentationMessageId: text(
      authoritativeEvent?.presentationMessageId || data?.presentationMessageId,
    ),
    runHandleId: text(transportContext?.runHandleId),
    bindingId: text(transportContext?.bindingId),
    readyState: webSocket.readyState,
  };
}

function classifyOutboundEvent(eventName, eventType) {
  return {
    toolFrame: eventType === "tool_call_start" || eventType === "tool_call_end",
    terminalLifecycle:
      eventName === TURN_LIFECYCLE_WIRE_EVENT &&
      [TURN_EVENT.COMPLETED, TURN_EVENT.STOP_COMPLETED, TURN_EVENT.FAILED].includes(eventType),
  };
}

function logRejectedTransport({
  logConnection,
  eventName,
  eventType,
  data,
  readyState,
  authoritativeEvent,
  transportDiagnostic,
  toolFrame,
  terminalLifecycle,
}) {
  if (authoritativeEvent) {
    logConnection("service.websocket.messageEvent.sendRejected", transportDiagnostic);
  }
  if (toolFrame) {
    logConnection("service.websocket.toolFrame.dropped", {
      eventName,
      eventType,
      readyState,
      sessionId: data?.sessionId,
      dialogProcessId: data?.dialogProcessId,
      turnScopeId: data?.turnScopeId,
    });
  }
  if (terminalLifecycle) {
    logConnection("service.authorityOutbox.terminalSendRejected", {
      eventId: data?.eventId,
      eventType,
      sequence: Number(data?.sequence || 0),
      sessionId: data?.sessionId,
      parentSessionId: data?.parentSessionId,
      dialogProcessId: data?.dialogProcessId,
      turnScopeId: data?.turnScopeId,
      readyState,
    });
  }
}

function enrichTransportData(eventName, data, protocolEnvelope, authoritativeEvent, sequence) {
  if (
    protocolEnvelope ||
    eventName === "attachment_lifecycle" ||
    usesExactAgentTransportPayload(eventName)
  ) {
    return data;
  }
  return {
    ...(data && typeof data === "object" ? data : {}),
    seq: sequence,
    dialogProcessId: text(authoritativeEvent?.dialogProcessId || data?.dialogProcessId),
    sessionId: text(authoritativeEvent?.sessionId || data?.route?.sessionId || data?.sessionId),
    turnScopeId: text(authoritativeEvent?.turnScopeId || data?.turnScopeId),
  };
}

function logSuccessfulTransport({
  logConnection,
  eventName,
  eventType,
  enrichedData,
  sequence,
  readyState,
  authoritativeEvent,
  transportDiagnostic,
  toolFrame,
  terminalLifecycle,
}) {
  if (authoritativeEvent) {
    logConnection("service.websocket.messageEvent.sendCompleted", {
      ...transportDiagnostic,
      transportSequence: sequence,
      readyState,
    });
  }
  if (toolFrame) {
    logConnection("service.websocket.toolFrame.sent", {
      eventName,
      eventType,
      seq: sequence,
      sessionId: enrichedData.sessionId,
      dialogProcessId: enrichedData.dialogProcessId,
      turnScopeId: enrichedData.turnScopeId,
    });
  }
  if (terminalLifecycle) {
    logConnection("service.authorityOutbox.terminalSent", {
      eventId: enrichedData.eventId,
      eventType,
      lifecycleSequence: Number(enrichedData.sequence || 0),
      transportSequence: sequence,
      sessionId: enrichedData.sessionId,
      parentSessionId: enrichedData.parentSessionId,
      dialogProcessId: enrichedData.dialogProcessId,
      turnScopeId: enrichedData.turnScopeId,
    });
  }
}

function recordSendFailure({ sessionLogConfig, state, eventName, enrichedData, error }) {
  void recordServiceWebSocketSendFailure({
    sessionLogConfig,
    eventName: text(eventName),
    userId: state.currentRunMeta?.userId || "",
    dialogProcessId: enrichedData.dialogProcessId,
    sessionId: enrichedData.sessionId,
    turnScopeId: enrichedData.turnScopeId,
    error,
  });
}

function sendPacket(context, packet, eventContext) {
  return new Promise((resolve) => {
    context.webSocket.send(packet, (error) => {
      if (error) {
        if (eventContext.authoritativeEvent) {
          context.logConnection("service.websocket.messageEvent.sendFailed", {
            ...eventContext.transportDiagnostic,
            error: error?.message || String(error || "websocket_send_failed"),
          });
        }
        recordSendFailure({ ...context, ...eventContext, error });
        resolve(false);
        return;
      }
      logSuccessfulTransport({
        ...eventContext,
        logConnection: context.logConnection,
        readyState: context.webSocket.readyState,
      });
      resolve(true);
    });
  });
}

export function createOutboundEventSender({ webSocket, state, logConnection, sessionLogConfig }) {
  let sequence = 0;
  return function sendEvent(eventName, data = {}, transportContext = {}) {
    const protocolEnvelope = getProtocolEnvelope(data);
    if (!validateOutboundProtocolEnvelope(protocolEnvelope, eventName, logConnection)) return false;
    const authoritativeEvent = getAuthoritativeMessageEvent(data);
    const eventType = resolveEventType(protocolEnvelope, authoritativeEvent, data);
    const transportDiagnostic = createTransportDiagnostic({
      protocolEnvelope,
      authoritativeEvent,
      data,
      eventType,
      transportContext,
      webSocket,
    });
    if (authoritativeEvent) {
      logConnection("service.websocket.messageEvent.sendStarted", transportDiagnostic);
    }
    const classification = classifyOutboundEvent(eventName, eventType);
    if (webSocket.readyState !== 1) {
      logRejectedTransport({
        logConnection,
        eventName,
        eventType,
        data,
        readyState: webSocket.readyState,
        authoritativeEvent,
        transportDiagnostic,
        ...classification,
      });
      return false;
    }
    sequence += 1;
    const enrichedData = enrichTransportData(
      eventName,
      data,
      protocolEnvelope,
      authoritativeEvent,
      sequence,
    );
    const eventContext = {
      eventName,
      eventType,
      enrichedData,
      sequence,
      authoritativeEvent,
      transportDiagnostic,
      ...classification,
    };
    try {
      return sendPacket(
        { webSocket, state, logConnection, sessionLogConfig },
        JSON.stringify({ event: eventName, data: enrichedData }),
        eventContext,
      );
    } catch (error) {
      recordSendFailure({ sessionLogConfig, state, ...eventContext, error });
      return false;
    }
  };
}
