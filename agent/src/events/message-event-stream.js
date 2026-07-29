/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "./index.js";
import {
  MESSAGE_EVENT_ENVELOPE_KIND,
  MESSAGE_EVENT_ENVELOPE_VERSION,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  assertMessageEventEnvelope,
  isMessageEventEnvelope,
} from "@noobot/shared/message-event-protocol";

export {
  MESSAGE_EVENT_ENVELOPE_KIND,
  MESSAGE_EVENT_ENVELOPE_VERSION,
  assertMessageEventEnvelope,
  isMessageEventEnvelope,
};

function text(value) {
  return String(value || "").trim();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function runtimeState(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return {};
  const systemRuntime = runtime.systemRuntime && typeof runtime.systemRuntime === "object"
    ? runtime.systemRuntime
    : (runtime.systemRuntime = {});
  if (!systemRuntime.messageEventStream || typeof systemRuntime.messageEventStream !== "object") {
    systemRuntime.messageEventStream = { sequence: 0, activeMessageId: "" };
  }
  return systemRuntime;
}

export function beginAssistantMessageEventStream(runtime = {}, { turn = 0 } = {}) {
  const state = runtimeState(runtime);
  const messageId = `msg_${randomUUID()}`;
  const presentationMessageId = text(
    runtime?.runConfig?.presentationMessageId ||
    runtime?.runConfig?.assistantMessageId ||
    state?.config?.presentationMessageId ||
    state?.config?.assistantMessageId ||
    messageId,
  );
  state.messageEventStream.activeMessageId = messageId;
  state.messageEventStream.activePresentationMessageId = presentationMessageId;
  state.messageEventStream.activeTurn = Number(turn || 0);
  state.messageEventStream.sequence = 0;
  return messageId;
}

export function currentAssistantMessageId(runtime = {}) {
  return text(runtimeState(runtime)?.messageEventStream?.activeMessageId);
}

export function currentAssistantPresentationMessageId(runtime = {}) {
  return text(runtimeState(runtime)?.messageEventStream?.activePresentationMessageId);
}

export function applyAuthoritativeMessageId(message = {}, messageId = "") {
  const id = text(messageId);
  if (!message || typeof message !== "object" || !id) return message;
  message.id = id;
  message.messageId = id;
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") message.additional_kwargs = {};
  message.additional_kwargs.noobotMessageId = id;
  return message;
}

export function createMessageEvent(runtime = {}, eventType = "", data = {}) {
  const state = runtimeState(runtime);
  const stream = state.messageEventStream || (state.messageEventStream = { sequence: 0 });
  const messageId = text(data?.messageId || stream.activeMessageId);
  if (!messageId) throw new Error(`authoritative message event requires messageId: ${eventType}`);
  const presentationMessageId = text(
    data?.presentationMessageId || stream.activePresentationMessageId || messageId,
  );
  if (!presentationMessageId) {
    throw new Error(`authoritative message event requires presentationMessageId: ${eventType}`);
  }
  const sequence = Math.max(0, Number(stream.sequence || 0)) + 1;
  stream.sequence = sequence;
  const eventId = text(data?.eventId) || `evt_${randomUUID()}`;
  const toolCallId = text(data?.toolCallId || data?.tool_call_id || data?.call?.id);
  const payload = deepFreeze({
    ...data,
    envelopeKind: MESSAGE_EVENT_ENVELOPE_KIND,
    envelopeVersion: MESSAGE_EVENT_ENVELOPE_VERSION,
    sequenceDomain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
    eventId,
    eventType: text(eventType),
    sessionId: text(data?.sessionId || state?.sessionId || runtime?.sessionId),
    dialogProcessId: text(data?.dialogProcessId || state?.dialogProcessId || state?.currentDialogProcessId),
    turnScopeId: text(data?.turnScopeId || state?.turnScopeId || state?.config?.turnScopeId || runtime?.runConfig?.turnScopeId),
    messageId,
    presentationMessageId,
    sequenceScopeId: messageId,
    ...(toolCallId ? { toolCallId } : {}),
    sequence,
    timestamp: new Date().toISOString(),
  });
  assertMessageEventEnvelope(payload);
  return payload;
}

export function emitPreparedMessageEvent(eventListener, payload = {}) {
  assertMessageEventEnvelope(payload);
  emitEvent(eventListener, payload.eventType, payload);
  return payload;
}

export function emitMessageEvent(eventListener, runtime = {}, eventType = "", data = {}) {
  const payload = createMessageEvent(runtime, eventType, data);
  const projected = runtime?.projectCurrentTurnMessageEvent?.(payload);
  if (runtime?.projectCurrentTurnMessageEvent && !projected) {
    throw new Error(`canonical message event projector rejected event: ${payload.eventId}`);
  }
  return emitPreparedMessageEvent(eventListener, payload);
}
