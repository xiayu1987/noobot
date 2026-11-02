/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  asEventProtocolEnvelope,
  validateProtocolEvent,
  EVENT_FAMILY,
} from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";
import { RUNTIME_EVENT_CATEGORIES } from "@noobot/runtime-events";
import { STREAM_DELTA_DEBUG_TYPE } from "@noobot/shared/runtime-events-config";
import { isSessionLogDebugTypeEnabled } from "@noobot/runtime-events/session-log-protocol";
import {
  classifyAgentTransportNonEnvelopeEvent,
  hasAgentTransportNonEnvelopePayloadContract,
  validateAgentTransportNonEnvelopePayload,
} from "@noobot/agent-transport-protocol";
import { isTerminalTurnEvent } from "@noobot/session-protocol";
import { recordServiceWebSocketSendFailure } from "./runtime-events.js";
import { text } from "@noobot/shared/value";

const TRANSIENT_DELTA_LOG_ROUTING = Object.freeze({
  category: RUNTIME_EVENT_CATEGORIES.DEBUG,
  level: "debug",
  debugType: STREAM_DELTA_DEBUG_TYPE,
});

function getProtocolEnvelope(data) {
  return asEventProtocolEnvelope(data);
}

function validateNonEnvelopeContract(nonEnvelopeKind, eventName, data) {
  if (!nonEnvelopeKind) return { valid: false, errors: ["unregistered_non_envelope_event"] };
  if (!hasAgentTransportNonEnvelopePayloadContract(eventName)) return { valid: true, errors: [] };
  return validateAgentTransportNonEnvelopePayload(eventName, data);
}

function validateOutboundNonEnvelopePayload(eventName, data, logConnection) {
  const nonEnvelopeKind = classifyAgentTransportNonEnvelopeEvent(eventName);
  const validation = validateNonEnvelopeContract(nonEnvelopeKind, eventName, data);
  if (validation.valid) return true;
  logConnection("service.websocket.nonEnvelopeEventRejected", {
    eventName,
    nonEnvelopeKind,
    errors: validation.errors,
  });
  return false;
}

function validateOutboundPayload(protocolEnvelope, eventName, data, logConnection) {
  if (!protocolEnvelope) return validateOutboundNonEnvelopePayload(eventName, data, logConnection);
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

function createTransportDiagnostic({ protocolEnvelope, eventName, transportContext, webSocket }) {
  const diagnostic = {
    eventType: eventName,
    runHandleId: text(transportContext?.runHandleId),
    bindingId: text(transportContext?.bindingId),
    readyState: webSocket.readyState,
  };
  if (!protocolEnvelope) return diagnostic;
  return {
    ...diagnostic,
    eventId: protocolEnvelope.identity.eventId,
    eventType: protocolEnvelope.identity.eventType,
    sessionId: protocolEnvelope.identity.sessionId,
    turnScopeId: protocolEnvelope.identity.turnScopeId,
    dialogProcessId: protocolEnvelope.payload.dialogProcessId,
    parentSessionId: protocolEnvelope.payload.parentSessionId,
    presentationMessageId: protocolEnvelope.payload.presentationMessageId,
    lifecycleSequence: protocolEnvelope.ordering.sequence,
  };
}

function classifyOutboundEvent(protocolEnvelope) {
  return {
    toolFrame:
      protocolEnvelope?.protocol.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
      ["tool_call_start", "tool_call_end"].includes(protocolEnvelope.payload.eventType),
    terminalLifecycle:
      protocolEnvelope?.protocol.family === EVENT_FAMILY.TURN_LIFECYCLE &&
      isTerminalTurnEvent(protocolEnvelope.payload.eventType),
  };
}

function logRejectedTransport({
  logConnection,
  eventName,
  eventType,
  readyState,
  transportDiagnostic,
  toolFrame,
  terminalLifecycle,
  authorityEnvelope,
}) {
  if (toolFrame) {
    logConnection("service.websocket.toolFrame.dropped", {
      eventName,
      eventType,
      readyState,
      ...transportDiagnostic,
    });
  }
  if (authorityEnvelope) {
    logConnection("service.authorityOutbox.eventSendRejected", {
      ...transportDiagnostic,
      eventName,
    });
  }
  if (terminalLifecycle) {
    logConnection("service.authorityOutbox.terminalSendRejected", {
      ...transportDiagnostic,
      readyState,
    });
  }
}

function logSuccessfulTransport({
  logConnection,
  eventName,
  eventType,
  sequence,
  readyState,
  transportDiagnostic,
  toolFrame,
  terminalLifecycle,
  authorityEnvelope,
  transientDelta,
}) {
  if (toolFrame) {
    logConnection("service.websocket.toolFrame.sent", {
      eventName,
      eventType,
      seq: sequence,
      ...transportDiagnostic,
    });
  }
  if (authorityEnvelope) {
    logConnection(
      "service.authorityOutbox.eventSent",
      {
        ...transportDiagnostic,
        eventName,
        transportSequence: sequence,
        readyState,
      },
      transientDelta ? TRANSIENT_DELTA_LOG_ROUTING : undefined,
    );
  }
  if (terminalLifecycle) {
    logConnection("service.authorityOutbox.terminalSent", {
      ...transportDiagnostic,
      transportSequence: sequence,
    });
  }
}

function recordSendFailure({ state, eventName, transportDiagnostic, error }) {
  void recordServiceWebSocketSendFailure({
    eventName: text(eventName),
    userId: state.currentRunMeta?.userId || "",
    dialogProcessId: transportDiagnostic.dialogProcessId,
    sessionId: transportDiagnostic.sessionId,
    turnScopeId: transportDiagnostic.turnScopeId,
    error,
  });
}

const SLOW_SEND_CALLBACK_MS = 20;
const DELIVERY_TIMING_LOG_ROUTING = Object.freeze({
  category: RUNTIME_EVENT_CATEGORIES.DEBUG,
  level: "debug",
  debugType: "delivery-timing",
});

function logSlowSendCallback(context, packet, eventContext, sendStartedAt, error) {
  const callbackMs = performance.now() - sendStartedAt;
  if (callbackMs <= SLOW_SEND_CALLBACK_MS) return;
  context.logConnection?.(
    "service.websocket.sendCallback.slow",
    {
      eventName: eventContext.eventName,
      eventType: eventContext.eventType,
      sequence: eventContext.sequence,
      callbackMs: Number(callbackMs.toFixed(2)),
      packetBytes: packet.length,
      bufferedAmount: context.webSocket.bufferedAmount,
      failed: Boolean(error),
    },
    DELIVERY_TIMING_LOG_ROUTING,
  );
}

function sendPacket(context, packet, eventContext) {
  return new Promise((resolve) => {
    const sendStartedAt = context.deliveryTimingEnabled ? performance.now() : 0;
    context.webSocket.send(packet, (error) => {
      if (context.deliveryTimingEnabled) {
        logSlowSendCallback(context, packet, eventContext, sendStartedAt, error);
      }
      if (error) {
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

export function createOutboundEventSender({ webSocket, state, logConnection }) {
  let sequence = 0;
  const deliveryTimingEnabled = isSessionLogDebugTypeEnabled("delivery-timing");
  return function sendEvent(eventName, data, transportContext = {}) {
    const protocolEnvelope = getProtocolEnvelope(data);
    if (!validateOutboundPayload(protocolEnvelope, eventName, data, logConnection)) return false;
    const transportDiagnostic = createTransportDiagnostic({
      protocolEnvelope,
      eventName,
      transportContext,
      webSocket,
    });
    const eventType = transportDiagnostic.eventType;
    const classification = {
      ...classifyOutboundEvent(protocolEnvelope),
      authorityEnvelope: Boolean(protocolEnvelope),
      transientDelta: Boolean(protocolEnvelope) && isTransientMessageEvent(protocolEnvelope),
    };
    if (webSocket.readyState !== 1) {
      logRejectedTransport({
        logConnection,
        eventName,
        eventType,
        readyState: webSocket.readyState,
        transportDiagnostic,
        ...classification,
      });
      return false;
    }
    sequence += 1;
    const eventContext = {
      eventName,
      eventType,
      sequence,
      transportDiagnostic,
      ...classification,
    };
    try {
      return sendPacket(
        { webSocket, state, logConnection, deliveryTimingEnabled },
        JSON.stringify({ event: eventName, data }),
        eventContext,
      );
    } catch (error) {
      recordSendFailure({ state, ...eventContext, error });
      return false;
    }
  };
}
