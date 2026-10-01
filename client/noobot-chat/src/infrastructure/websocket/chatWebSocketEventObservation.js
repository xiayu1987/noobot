/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFrameHealthSampler } from "./frameHealthSampler.js";
import { logEventProcessingTiming } from "../../modules/debug/loggers/eventProcessingTimingLogger.js";
import { normalizeTrimmedString } from "./chatWebSocketProtocol.js";

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeReceivedEventIdentity(identity = {}) {
  return {
    sessionId: normalizeTrimmedString(identity.sessionId),
    turnScopeId: normalizeTrimmedString(identity.turnScopeId),
    eventId: normalizeTrimmedString(identity.eventId),
    messageId: normalizeTrimmedString(identity.messageId),
  };
}

function summarizeReceivedEventPayload(payload = {}) {
  return {
    dialogProcessId: normalizeTrimmedString(payload.dialogProcessId),
    eventType: normalizeTrimmedString(payload.eventType),
    parentSessionId: normalizeTrimmedString(payload.parentSessionId),
    presentationMessageId: normalizeTrimmedString(payload.presentationMessageId),
    contentLength: String(payload.content ?? payload.text ?? "").length,
    attachmentCount: countArray(payload.attachments),
    transferEnvelopeCount: countArray(payload.transferEnvelopes),
  };
}

export function summarizeReceivedEventData(data) {
  return {
    ...summarizeReceivedEventIdentity(data?.identity || {}),
    ...summarizeReceivedEventPayload(data?.payload || {}),
  };
}

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export function createEventProcessingTimingRecorder() {
  const frameHealthSampler = createFrameHealthSampler();
  return function recordEventProcessingTiming({
    messageEvent,
    timingStartedAt,
    dispatchEndedAt,
    event,
    data,
    lifecycleData,
    owner,
  }) {
    const receivedAt = Number(messageEvent?.timeStamp);
    const summary = {
      ...summarizeReceivedEventData(data),
      protocolEvent: event,
      lifecycleEventType: normalizeTrimmedString(lifecycleData?.eventType),
      lifecycleEventId: normalizeTrimmedString(lifecycleData?.eventId),
      rawLength: String(messageEvent?.data || "").length,
      owner,
      visibilityState: globalThis.document?.visibilityState || "",
      queueDelayMs: roundMs(receivedAt > 0 ? timingStartedAt - receivedAt : NaN),
      dispatchMs: roundMs(dispatchEndedAt - timingStartedAt),
    };
    frameHealthSampler.start();
    const scheduleFrame =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (callback) => setTimeout(callback, 0);
    scheduleFrame(() => {
      logEventProcessingTiming("frontend.websocket.eventProcessingTiming", () => ({
        ...summary,
        nextFrameMs: roundMs(performance.now() - dispatchEndedAt),
        frameHealth: frameHealthSampler.drain(),
      }));
    });
  };
}
