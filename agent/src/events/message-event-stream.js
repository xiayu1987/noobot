/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createModelMessageId } from "@noobot/session-protocol/message-identity";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import {
  EVENT_FAMILY,
  createEventEnvelope,
  createEventId,
  validateProtocolEvent,
} from "@noobot/event-protocol";
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
import { firstText, text, isObjectLike } from "@noobot/shared/value";

export { assertMessageEventPayload };

function runtimeState(runtime) {
  const systemRuntime = runtime?.systemRuntime;
  if (!isObjectLike(systemRuntime)) {
    throw new TypeError(
      "message event stream requires runtime.systemRuntime from createRuntimeContext",
    );
  }
  if (!isObjectLike(systemRuntime.messageEventStream)) {
    systemRuntime.messageEventStream = { activePresentationMessageId: "" };
  }
  return systemRuntime;
}

function resolveRequestedStreamIdentity(runConfig, state, requested) {
  const config = state.config || {};
  return {
    presentationMessageId: firstText(
      requested.presentationMessageId,
      runConfig.presentationMessageId,
      config.presentationMessageId,
    ),

    parentSessionId: requested.parentSessionId,
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
  if (typeof identity.parentSessionId !== "string") {
    throw new TypeError("turn message event parentSessionId must be a string");
  }
  if (!identity.presentationMessageId) {
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
  { presentationMessageId = "", parentSessionId, workflowRunId = "", nodeExecutionId = "" } = {},
) {
  const state = runtimeState(runtime);
  const identity = resolveRequestedStreamIdentity(runtime?.runConfig || {}, state, {
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
  if (!text(stream.activePresentationMessageId)) {
    throw new Error("Turn message event domain must be bound before model invocation");
  }
  const modelMessageId = createModelMessageId();
  stream.activeModelMessageId = modelMessageId;
  state.messageEventStream.activeTurn = Number(turn || 0);
  return modelMessageId;
}

export function currentAssistantPresentationMessageId(runtime = {}) {
  return text(runtimeState(runtime)?.messageEventStream?.activePresentationMessageId);
}

function createMessageEventPayload(runtime = {}, eventType = "", data = {}) {
  const state = runtimeState(runtime);
  const stream = state.messageEventStream || (state.messageEventStream = {});
  const presentationMessageId = text(stream.activePresentationMessageId);
  if (data?.messageId !== undefined || data?.presentationMessageId !== undefined) {
    throw new Error(`message event payload must not carry stream identity: ${eventType}`);
  }
  if (!presentationMessageId) {
    throw new Error(`authoritative message event requires presentationMessageId: ${eventType}`);
  }
  const toolCallId = text(data?.toolCallId);

  const modelScoped = MODEL_MESSAGE_SCOPED_EVENT_TYPES.has(text(eventType));
  const modelMessageId = modelScoped ? text(stream.activeModelMessageId) : "";
  const payload = deepFreeze({
    ...data,
    eventType: text(eventType),
    parentSessionId: text(stream.parentSessionId),
    dialogProcessId: text(state?.dialogProcessId),
    ...(text(stream.workflowRunId) ? { workflowRunId: text(stream.workflowRunId) } : {}),
    ...(text(stream.nodeExecutionId) ? { nodeExecutionId: text(stream.nodeExecutionId) } : {}),
    presentationMessageId,
    ...(modelMessageId ? { modelMessageId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  });
  assertMessageEventPayload(payload);
  return payload;
}

function messageEventCommitInput(runtime, state, payload) {
  return {
    userId: text(runtime?.systemRuntime?.userId),
    sessionId: text(state?.sessionId),
    turnScopeId: text(state?.turnScopeId),
    executionId: text(runtime?.runConfig?.executionId),
    commandId: text(runtime?.runConfig?.commandId),
    correlationId: text(runtime?.runConfig?.turnScopeId),
    payload,
    persistenceScope: state.persistenceScope,
  };
}

function createTransientMessageEventEnvelope(input) {
  if (!input.sessionId || !input.turnScopeId || !input.payload?.presentationMessageId) {
    throw new TypeError("message event requires session, Turn and message identity");
  }
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: createEventId(),
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: input.sessionId,
      turnScopeId: input.turnScopeId,
      executionId: input.executionId,
    },
    causality: {
      commandId: input.commandId,
      causationId: "",
      correlationId: input.correlationId,
    },
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: input.payload.presentationMessageId,
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
    persistenceScope: state.persistenceScope,
  });
  return envelope;
}
