/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireCommittedAuthorityEvent } from "@noobot/event-protocol/outbox";
import { createModelMessageId } from "@noobot/session-protocol/message-identity";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import {
  EVENT_FAMILY,
  createEventEnvelope,
  getEventFamily,
  createEventId,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import { emitEvent } from "./emitter.js";
import {
  MODEL_MESSAGE_SCOPED_EVENT_TYPES,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
  MESSAGE_RUNTIME_PRODUCER,
  TRANSIENT_MESSAGE_EVENT_SEQUENCE,
  assertMessageEventPayload,
  isTransientMessageEventType,
} from "@noobot/event-protocol/message-event";
import { AGENT_RUN_EVENT } from "./run-event.js";
import { isObjectLike, isPlainObject } from "@noobot/shared/value";

export { assertMessageEventPayload };

export function createMessageEventStreamState() {
  return {
    activePresentationMessageId: "",
    parentSessionId: "",
    workflowNodeOwnership: null,
    activeAssistantDraft: null,
    activeTurn: 0,
  };
}

function runtimeState(runtime) {
  const systemRuntime = runtime.systemRuntime;
  if (!isObjectLike(systemRuntime) || !isObjectLike(systemRuntime.messageEventStream)) {
    throw new TypeError(
      "message event stream requires runtime.systemRuntime.messageEventStream from createRuntimeContext",
    );
  }
  return systemRuntime;
}

function assertRequestedStreamIdentity(identity) {
  for (const key of ["presentationMessageId", "parentSessionId"]) {
    if (typeof identity[key] !== "string") {
      throw new TypeError(`turn message event ${key} must be a string`);
    }
  }
  if (!identity.presentationMessageId) {
    throw new Error("turn message event identity is incomplete");
  }
  const ownership = identity.workflowNodeOwnership;
  if (ownership !== null && !isPlainObject(ownership)) {
    throw new TypeError(
      "turn message event workflowNodeOwnership must be projectWorkflowNodeOwnership output",
    );
  }
  if (ownership !== null && !identity.parentSessionId) {
    throw new Error("turn message event workflow parent session identity is incomplete");
  }
}

function sameWorkflowNodeOwnership(current, next) {
  if (current === null || next === null) return current === next;
  return (
    current.workflowRunId === next.workflowRunId && current.nodeExecutionId === next.nodeExecutionId
  );
}

function assertStreamIdentityCompatible(stream, identity) {
  if (
    stream.activePresentationMessageId &&
    stream.activePresentationMessageId !== identity.presentationMessageId
  ) {
    throw new Error("turn message event presentationMessageId conflict");
  }
  if (stream.parentSessionId && stream.parentSessionId !== identity.parentSessionId) {
    throw new Error("turn message event parentSessionId conflict");
  }
  if (
    stream.workflowNodeOwnership !== null &&
    !sameWorkflowNodeOwnership(stream.workflowNodeOwnership, identity.workflowNodeOwnership)
  ) {
    throw new Error("turn message event workflowNodeOwnership conflict");
  }
}

export function bindAssistantMessageEventStream(
  runtime,
  { presentationMessageId, parentSessionId, workflowNodeOwnership },
) {
  const state = runtimeState(runtime);
  const identity = { presentationMessageId, parentSessionId, workflowNodeOwnership };
  assertRequestedStreamIdentity(identity);
  const stream = state.messageEventStream;
  assertStreamIdentityCompatible(stream, identity);
  stream.activePresentationMessageId = presentationMessageId;
  stream.parentSessionId = parentSessionId;
  stream.workflowNodeOwnership =
    workflowNodeOwnership === null ? null : Object.freeze({ ...workflowNodeOwnership });
  return stream;
}

export function beginAssistantMessageEventStream(runtime, { turn, modelAlias, modelName }) {
  if (!Number.isInteger(turn) || turn < 0) {
    throw new TypeError("assistant message stream turn must be an integer >= 0");
  }
  const state = runtimeState(runtime);
  const stream = state.messageEventStream;
  if (!stream.activePresentationMessageId) {
    throw new Error("Turn message event domain must be bound before model invocation");
  }
  const modelMessageId = createModelMessageId();

  stream.activeAssistantDraft = {
    modelMessageId,
    content: "",
    modelAlias,
    modelName,
    committed: false,
  };
  stream.activeTurn = turn;
  return modelMessageId;
}

export function appendAssistantDraftContent(runtime, visibleText) {
  if (typeof visibleText !== "string") {
    throw new TypeError("assistant draft content must be a string");
  }
  const draft = runtimeState(runtime).messageEventStream.activeAssistantDraft;
  if (!draft) throw new Error("assistant draft requires an active model message stream");
  draft.content += visibleText;
}

export function currentAssistantDraft(runtime) {
  const draft = runtimeState(runtime).messageEventStream.activeAssistantDraft;
  return draft ? Object.freeze({ ...draft }) : null;
}

export function markAssistantDraftCommitted(runtime, modelMessageId) {
  const draft = runtimeState(runtime).messageEventStream.activeAssistantDraft;
  if (draft && draft.modelMessageId === modelMessageId) draft.committed = true;
}

export function discardAssistantDraft(runtime, modelMessageId) {
  const stream = runtimeState(runtime).messageEventStream;
  const draft = stream.activeAssistantDraft;
  if (!draft || draft.modelMessageId !== modelMessageId) {
    throw new Error("assistant draft discard requires the active model message stream");
  }
  stream.activeAssistantDraft = null;
}

export function currentAssistantPresentationMessageId(runtime) {
  return runtimeState(runtime).messageEventStream.activePresentationMessageId;
}

function createMessageEventPayload(runtime, eventType, data) {
  const state = runtimeState(runtime);
  const stream = state.messageEventStream;
  const presentationMessageId = stream.activePresentationMessageId;
  if (!isPlainObject(data)) {
    throw new TypeError(`message event data must be a plain object: ${eventType}`);
  }
  if (Object.hasOwn(data, "messageId") || Object.hasOwn(data, "presentationMessageId")) {
    throw new Error(`message event payload must not carry stream identity: ${eventType}`);
  }
  if (!presentationMessageId) {
    throw new Error(`authoritative message event requires presentationMessageId: ${eventType}`);
  }
  const draft = stream.activeAssistantDraft;
  const modelMessageId =
    MODEL_MESSAGE_SCOPED_EVENT_TYPES.has(eventType) && draft !== null ? draft.modelMessageId : "";
  const payload = deepFreeze({
    ...data,
    eventType,
    parentSessionId: stream.parentSessionId,
    dialogProcessId: state.dialogProcessId,
    ...(stream.workflowNodeOwnership === null ? {} : stream.workflowNodeOwnership),
    presentationMessageId,
    ...(modelMessageId ? { modelMessageId } : {}),
  });
  assertMessageEventPayload(payload);
  return payload;
}

function messageEventCommitInput(runtime, state, payload) {
  return {
    userId: state.userId,
    sessionId: state.sessionId,
    turnScopeId: state.turnScopeId,
    executionId: runtime.runConfig.executionId,
    commandId: runtime.runConfig.commandId,
    correlationId: state.turnScopeId,
    producer: MESSAGE_RUNTIME_PRODUCER,
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
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
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
    producer: input.producer,
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
  return requireCommittedAuthorityEvent(await runtime.sessionManager.commitMessageEvent(input));
}

export async function emitMessageEvent(eventListener, runtime, eventType, data) {
  const payload = createMessageEventPayload(runtime, eventType, data);
  const state = runtimeState(runtime);
  const input = messageEventCommitInput(runtime, state, payload);
  const envelope = isTransientMessageEventType(payload.eventType)
    ? createTransientMessageEventEnvelope(input)
    : await commitDurableMessageEvent(runtime, input);
  await runtime.projectCurrentTurnMessageEvent(envelope);
  await emitEvent(eventListener, AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED, {
    envelope,
    persistenceScope: state.persistenceScope,
  });
  return envelope;
}
