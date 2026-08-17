/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "./index.js";
import {
  assertMessageEventPayload,
} from "@noobot/event-protocol/message-event";

export { assertMessageEventPayload };

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
    systemRuntime.messageEventStream = { activeMessageId: "" };
  }
  return systemRuntime;
}

export function bindAssistantMessageEventStream(runtime = {}, {
  messageId = "",
  presentationMessageId = "",
  parentSessionId = "",
  workflowRunId = "",
  nodeExecutionId = "",
} = {}) {
  const state = runtimeState(runtime);
  const requestedMessageId = text(
    messageId ||
    runtime?.runConfig?.messageId ||
    state?.config?.messageId,
  );
  const requestedPresentationMessageId = text(
    presentationMessageId ||
    runtime?.runConfig?.presentationMessageId ||
    state?.config?.presentationMessageId ||
    requestedMessageId,
  );
  const requestedParentSessionId = text(
    parentSessionId || runtime?.runConfig?.parentSessionId || state?.parentSessionId,
  );
  const requestedWorkflowRunId = text(
    workflowRunId || runtime?.runConfig?.workflowRunId || state?.config?.workflowRunId,
  );
  const requestedNodeExecutionId = text(
    nodeExecutionId ||
    runtime?.runConfig?.workflowNodeExecutionId ||
    runtime?.runConfig?.nodeExecutionId ||
    state?.config?.workflowNodeExecutionId ||
    state?.config?.nodeExecutionId,
  );
  if (!requestedMessageId || !requestedPresentationMessageId) {
    throw new Error("turn message event identity is incomplete");
  }
  if (Boolean(requestedWorkflowRunId) !== Boolean(requestedNodeExecutionId)) {
    throw new Error("turn message event workflow identity is incomplete");
  }
  if (requestedWorkflowRunId && !requestedParentSessionId) {
    throw new Error("turn message event workflow parent session identity is incomplete");
  }
  const stream = state.messageEventStream;
  const currentMessageId = text(stream.activeMessageId);
  const currentPresentationMessageId = text(stream.activePresentationMessageId);
  if (currentMessageId && currentMessageId !== requestedMessageId) {
    throw new Error("turn message event messageId conflict");
  }
  if (currentPresentationMessageId && currentPresentationMessageId !== requestedPresentationMessageId) {
    throw new Error("turn message event presentationMessageId conflict");
  }
  const currentParentSessionId = text(stream.parentSessionId);
  const currentWorkflowRunId = text(stream.workflowRunId);
  const currentNodeExecutionId = text(stream.nodeExecutionId);
  if (currentParentSessionId && currentParentSessionId !== requestedParentSessionId) {
    throw new Error("turn message event parentSessionId conflict");
  }
  if (currentWorkflowRunId && currentWorkflowRunId !== requestedWorkflowRunId) {
    throw new Error("turn message event workflowRunId conflict");
  }
  if (currentNodeExecutionId && currentNodeExecutionId !== requestedNodeExecutionId) {
    throw new Error("turn message event nodeExecutionId conflict");
  }
  stream.activeMessageId = requestedMessageId;
  stream.activePresentationMessageId = requestedPresentationMessageId;
  stream.parentSessionId = requestedParentSessionId;
  stream.workflowRunId = requestedWorkflowRunId;
  stream.nodeExecutionId = requestedNodeExecutionId;
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
  // Model values are immutable protocol snapshots. Adding the authoritative
  // message identity is therefore a value transformation, never mutation.
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
  if (text(data?.messageId) && text(stream.activeMessageId) && messageId !== text(stream.activeMessageId)) {
    throw new Error(`authoritative message event messageId conflicts with Turn domain: ${eventType}`);
  }
  const presentationMessageId = text(
    data?.presentationMessageId || stream.activePresentationMessageId || messageId,
  );
  if (!presentationMessageId) {
    throw new Error(`authoritative message event requires presentationMessageId: ${eventType}`);
  }
  const toolCallId = text(data?.toolCallId);
  const payload = deepFreeze({
    ...data,
    eventType: text(eventType),
    parentSessionId: text(data?.parentSessionId || stream.parentSessionId || state?.parentSessionId),
    dialogProcessId: text(data?.dialogProcessId || state?.dialogProcessId || state?.currentDialogProcessId),
    ...(text(data?.workflowRunId || stream.workflowRunId)
      ? { workflowRunId: text(data?.workflowRunId || stream.workflowRunId) }
      : {}),
    ...(text(data?.nodeExecutionId || stream.nodeExecutionId)
      ? { nodeExecutionId: text(data?.nodeExecutionId || stream.nodeExecutionId) }
      : {}),
    presentationMessageId,
    ...(toolCallId ? { toolCallId } : {}),
  });
  assertMessageEventPayload(payload);
  return payload;
}

export async function emitMessageEvent(eventListener, runtime = {}, eventType = "", data = {}) {
  const payload = createMessageEventPayload(runtime, eventType, data);
  const state = runtimeState(runtime);
  const committed = await runtime?.sessionManager?.commitMessageEvent?.({
    userId: text(runtime?.userId),
    sessionId: text(state?.sessionId || runtime?.sessionId),
    parentSessionId: text(payload.parentSessionId),
    turnScopeId: text(state?.turnScopeId || state?.config?.turnScopeId || runtime?.runConfig?.turnScopeId),
    messageId: text(state?.messageEventStream?.activeMessageId),
    executionId: text(runtime?.runConfig?.executionId),
    commandId: text(runtime?.runConfig?.commandId),
    correlationId: text(runtime?.runConfig?.turnScopeId),
    payload,
    persistenceContext: runtime?.runConfig?.persistenceContext || null,
  });
  if (!committed?.committed || !committed?.envelope) {
    throw new Error(`authoritative message event commit failed: ${committed?.reason || "unknown"}`);
  }
  const projected = runtime?.projectCurrentTurnMessageEvent?.(committed.envelope);
  if (runtime?.projectCurrentTurnMessageEvent && !projected) {
    throw new Error(`canonical message event projector rejected event: ${committed.envelope.identity.eventId}`);
  }
  await emitEvent(eventListener, "authority_event_committed", {
    envelope: committed.envelope,
    persistenceScope: runtime?.runConfig?.persistenceContext || null,
  });
  return committed.envelope;
}
