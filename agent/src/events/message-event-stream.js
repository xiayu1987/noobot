/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { EVENT_FAMILY, createEventEnvelope, validateProtocolEvent } from "@noobot/event-protocol";
import { emitEvent } from "./emitter.js";
import {
  MODEL_MESSAGE_SCOPED_EVENT_TYPES,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
  TRANSIENT_MESSAGE_EVENT_SEQUENCE,
  assertMessageEventPayload,
  isTransientMessageEventType,
} from "@noobot/event-protocol/message-event";
import { AGENT_RUN_EVENT } from "./run-event.js";

export { assertMessageEventPayload };

function text(value) {
  return String(value || "").trim();
}

function runtimeState(runtime = {}) {
  if (!runtime || typeof runtime !== "object") return {};
  const systemRuntime =
    runtime.systemRuntime && typeof runtime.systemRuntime === "object"
      ? runtime.systemRuntime
      : (runtime.systemRuntime = {});
  if (!systemRuntime.messageEventStream || typeof systemRuntime.messageEventStream !== "object") {
    systemRuntime.messageEventStream = { activeMessageId: "" };
  }
  return systemRuntime;
}

function firstText(...values) {
  return text(values.find(Boolean));
}

function resolveRequestedStreamIdentity(runConfig, state, requested) {
  const config = state.config || {};
  const messageId = firstText(requested.messageId, runConfig.messageId, config.messageId);
  return {
    messageId,
    presentationMessageId: firstText(
      requested.presentationMessageId,
      runConfig.presentationMessageId,
      config.presentationMessageId,
      messageId,
    ),
    parentSessionId: firstText(
      requested.parentSessionId,
      runConfig.parentSessionId,
      state.parentSessionId,
    ),
    workflowRunId: firstText(
      requested.workflowRunId,
      runConfig.workflowRunId,
      config.workflowRunId,
    ),
    nodeExecutionId: firstText(
      requested.nodeExecutionId,
      runConfig.workflowNodeExecutionId,
      runConfig.nodeExecutionId,
      config.workflowNodeExecutionId,
      config.nodeExecutionId,
    ),
  };
}

function assertRequestedStreamIdentity(identity) {
  if (!identity.messageId || !identity.presentationMessageId) {
    throw new Error("turn message event identity is incomplete");
  }
  if (Boolean(identity.workflowRunId) !== Boolean(identity.nodeExecutionId)) {
    throw new Error("turn message event workflow identity is incomplete");
  }
  if (identity.workflowRunId && !identity.parentSessionId) {
    throw new Error("turn message event workflow parent session identity is incomplete");
  }
}

const STREAM_IDENTITY_BINDINGS = Object.freeze([
  ["activeMessageId", "messageId"],
  ["activePresentationMessageId", "presentationMessageId"],
  ["parentSessionId", "parentSessionId"],
  ["workflowRunId", "workflowRunId"],
  ["nodeExecutionId", "nodeExecutionId"],
]);

function assertStreamIdentityCompatible(stream, identity) {
  for (const [streamKey, identityKey] of STREAM_IDENTITY_BINDINGS) {
    const current = text(stream[streamKey]);
    if (current && current !== identity[identityKey]) {
      throw new Error(`turn message event ${identityKey} conflict`);
    }
  }
}

export function bindAssistantMessageEventStream(
  runtime = {},
  {
    messageId = "",
    presentationMessageId = "",
    parentSessionId = "",
    workflowRunId = "",
    nodeExecutionId = "",
  } = {},
) {
  const state = runtimeState(runtime);
  const identity = resolveRequestedStreamIdentity(runtime?.runConfig || {}, state, {
    messageId,
    presentationMessageId,
    parentSessionId,
    workflowRunId,
    nodeExecutionId,
  });
  assertRequestedStreamIdentity(identity);
  const stream = state.messageEventStream;
  assertStreamIdentityCompatible(stream, identity);
  for (const [streamKey, identityKey] of STREAM_IDENTITY_BINDINGS) {
    stream[streamKey] = identity[identityKey];
  }
  return stream;
}

export function beginAssistantMessageEventStream(runtime = {}, { turn = 0 } = {}) {
  const state = runtimeState(runtime);
  const stream = state.messageEventStream;
  if (!text(stream.activeMessageId)) {
    throw new Error("Turn message event domain must be bound before model invocation");
  }
  const modelMessageId = `msg_${randomUUID()}`;
  stream.activeModelMessageId = modelMessageId;
  state.messageEventStream.activeTurn = Number(turn || 0);
  return modelMessageId;
}

export function currentAssistantMessageId(runtime = {}) {
  return text(runtimeState(runtime)?.messageEventStream?.activeMessageId);
}

export function currentAssistantPresentationMessageId(runtime = {}) {
  return text(runtimeState(runtime)?.messageEventStream?.activePresentationMessageId);
}

export function currentAssistantModelMessageId(runtime = {}) {
  return text(runtimeState(runtime)?.messageEventStream?.activeModelMessageId);
}

export function applyAuthoritativeMessageId(message = {}, messageId = "") {
  const id = text(messageId);
  if (!message || typeof message !== "object" || !id) return message;

  const target = { ...message };
  target.id = id;
  target.messageId = id;
  const additionalKwargs =
    target.additional_kwargs && typeof target.additional_kwargs === "object"
      ? { ...target.additional_kwargs }
      : {};
  additionalKwargs.noobotMessageId = id;
  target.additional_kwargs = additionalKwargs;
  return target;
}

export function createMessageEventPayload(runtime = {}, eventType = "", data = {}) {
  const state = runtimeState(runtime);
  const stream = state.messageEventStream || (state.messageEventStream = {});
  const messageId = text(data?.messageId || stream.activeMessageId);
  if (!messageId) throw new Error(`authoritative message event requires messageId: ${eventType}`);
  if (
    text(data?.messageId) &&
    text(stream.activeMessageId) &&
    messageId !== text(stream.activeMessageId)
  ) {
    throw new Error(
      `authoritative message event messageId conflicts with Turn domain: ${eventType}`,
    );
  }
  const presentationMessageId = text(
    data?.presentationMessageId || stream.activePresentationMessageId || messageId,
  );
  if (!presentationMessageId) {
    throw new Error(`authoritative message event requires presentationMessageId: ${eventType}`);
  }
  const toolCallId = text(data?.toolCallId);

  const modelScoped = MODEL_MESSAGE_SCOPED_EVENT_TYPES.has(text(eventType));
  const modelMessageId = modelScoped ? text(stream.activeModelMessageId) : "";
  const payload = deepFreeze({
    ...data,
    eventType: text(eventType),
    parentSessionId: text(
      data?.parentSessionId || stream.parentSessionId || state?.parentSessionId,
    ),
    dialogProcessId: text(
      data?.dialogProcessId || state?.dialogProcessId || state?.currentDialogProcessId,
    ),
    ...(text(data?.workflowRunId || stream.workflowRunId)
      ? { workflowRunId: text(data?.workflowRunId || stream.workflowRunId) }
      : {}),
    ...(text(data?.nodeExecutionId || stream.nodeExecutionId)
      ? { nodeExecutionId: text(data?.nodeExecutionId || stream.nodeExecutionId) }
      : {}),
    presentationMessageId,
    ...(modelMessageId ? { modelMessageId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  });
  assertMessageEventPayload(payload);
  return payload;
}

function messageEventCommitInput(runtime, state, payload) {
  return {
    userId: text(runtime?.userId),
    sessionId: text(state?.sessionId || runtime?.sessionId),
    parentSessionId: text(payload.parentSessionId),
    turnScopeId: text(
      state?.turnScopeId || state?.config?.turnScopeId || runtime?.runConfig?.turnScopeId,
    ),
    messageId: text(state?.messageEventStream?.activeMessageId),
    executionId: text(runtime?.runConfig?.executionId),
    commandId: text(runtime?.runConfig?.commandId),
    correlationId: text(runtime?.runConfig?.turnScopeId),
    payload,
    persistenceContext: state?.persistenceContext || null,
  };
}

function createTransientMessageEventEnvelope(input) {
  if (!input.sessionId || !input.turnScopeId || !input.messageId) {
    throw new TypeError("message event requires session, Turn and message identity");
  }
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: `evt_${randomUUID()}`,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: input.sessionId,
      turnScopeId: input.turnScopeId,
      messageId: input.messageId,
      executionId: input.executionId,
    },
    causality: {
      commandId: input.commandId,
      causationId: "",
      correlationId: input.correlationId,
    },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: input.messageId,
      sequence: TRANSIENT_MESSAGE_EVENT_SEQUENCE,
    },
    producer: { type: "agent", id: "message-runtime" },
    occurredAt: new Date().toISOString(),
    payload: input.payload,
  });
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) {
    throw new TypeError(`invalid transient message event: ${validation.errors.join(",")}`);
  }
  return envelope;
}

async function commitDurableMessageEvent(runtime, input) {
  const committed = await runtime?.sessionManager?.commitMessageEvent?.(input);
  if (!committed?.committed || !committed?.envelope) {
    throw new Error(`authoritative message event commit failed: ${committed?.reason || "unknown"}`);
  }
  return committed.envelope;
}

export async function emitMessageEvent(eventListener, runtime = {}, eventType = "", data = {}) {
  const payload = createMessageEventPayload(runtime, eventType, data);
  const state = runtimeState(runtime);
  const input = messageEventCommitInput(runtime, state, payload);
  const envelope = isTransientMessageEventType(payload.eventType)
    ? createTransientMessageEventEnvelope(input)
    : await commitDurableMessageEvent(runtime, input);
  const projected = await runtime?.projectCurrentTurnMessageEvent?.(envelope);
  if (runtime?.projectCurrentTurnMessageEvent && !projected) {
    throw new Error(
      `canonical message event projector rejected event: ${envelope.identity.eventId}`,
    );
  }
  await emitEvent(eventListener, AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED, {
    envelope,
    persistenceScope: state?.persistenceScope || null,
  });
  return envelope;
}
