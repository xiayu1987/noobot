/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";
import {
  bindAssistantMessageEventStream,
  emitMessageEvent,
} from "../../../events/message-event-stream.js";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { initializeCurrentTurnMessageEventProjection } from "../../../events/current-turn-message-event-projection.js";
import { applyRuntimeUserMessageAttachments } from "../../../artifacts/index.js";
import { getAgentContextEnvelope } from "../../../context/agent-context-accessor.js";
import { bindLifecycleToRuntime } from "../../../runtime/lifecycle/state-machine.js";
import { initializeAgentModelHost } from "../../../runtime/model-port-host.js";
import { buildAgentTransportConsumption } from "./agent-transport-consumption.js";
import { bindCurrentTurnPersistence } from "./current-turn-persistence.js";

function projectPresentationAttachments(attachments) {
  return Array.isArray(attachments)
    ? attachments.map((attachment = {}) => ({ ...attachment }))
    : [];
}

function projectUserPresentationMessage({
  currentUserMessage,
  sessionId,
  parentSessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
}) {
  const messageId = String(currentUserMessage?.messageId || currentUserMessage?.id || "").trim();
  return {
    id: messageId,
    messageId,
    messageUid: String(currentUserMessage?.messageUid || "").trim(),
    sessionId,
    parentSessionId,
    dialogProcessId,
    parentDialogProcessId,
    turnScopeId,
    role: "user",
    type: String(currentUserMessage?.type || "message").trim(),
    content: String(currentUserMessage?.content || ""),
    attachments: projectPresentationAttachments(currentUserMessage?.attachments),
    frontendUserMessage: currentUserMessage?.frontendUserMessage === true,
    ts: currentUserMessage?.ts,
  };
}

export async function bindAgentDispatchRuntime({
  runtimeAgentContext,
  botHookRuntime,
  lifecycle,
  messageId,
  presentationMessageId,
  userMessageAttachments,
  appendAgentMessages,
  getSessionTurns,
  commitSummaryCheckpoint,
  userId,
  sessionId,
  parentSessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
  eventListener,
  persistenceContext,
  persistenceScope,
  normalizedMessage,
  requestedAttachments,
  canonicalAttachments,
  currentUserMessage,
  resolvedRunConfig,
  turnCommand,
  committedTurnResult,
}) {
  const dispatchRuntime = runtimeAgentContext?.bindings?.runtime;
  if (!dispatchRuntime || typeof dispatchRuntime !== "object") return dispatchRuntime;

  dispatchRuntime.eventListener = eventListener;
  const systemRuntime =
    dispatchRuntime.systemRuntime && typeof dispatchRuntime.systemRuntime === "object"
      ? dispatchRuntime.systemRuntime
      : (dispatchRuntime.systemRuntime = {});
  systemRuntime.sessionId = sessionId;
  systemRuntime.dialogProcessId = dialogProcessId;
  systemRuntime.turnScopeId = turnScopeId;
  systemRuntime.config =
    systemRuntime.config && typeof systemRuntime.config === "object" ? systemRuntime.config : {};
  systemRuntime.config.turnScopeId = turnScopeId;
  systemRuntime.persistenceContext = persistenceContext || null;
  systemRuntime.persistenceScope = persistenceScope || null;

  const modelHost = initializeAgentModelHost({
    runtime: dispatchRuntime,
    invocationIdentity: getAgentContextEnvelope(runtimeAgentContext).identity,
  });
  botHookRuntime.modelHost = modelHost;
  botHookRuntime.modelPort = modelHost.modelPort;
  botHookRuntime.modelSpec = modelHost.modelSpec;
  bindAssistantMessageEventStream(dispatchRuntime, {
    messageId,
    presentationMessageId,
    parentSessionId,
    workflowRunId: String(resolvedRunConfig?.workflowRunId || "").trim(),
    nodeExecutionId: String(
      resolvedRunConfig?.workflowNodeExecutionId || resolvedRunConfig?.nodeExecutionId || "",
    ).trim(),
  });
  applyRuntimeUserMessageAttachments(dispatchRuntime, userMessageAttachments);
  bindLifecycleToRuntime(dispatchRuntime, lifecycle);
  initializeCurrentTurnMessageEventProjection(dispatchRuntime, { sequenceScopeId: turnScopeId });
  await emitMessageEvent(
    eventListener,
    dispatchRuntime,
    MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED,
    {
      presentation: {
        userMessage: projectUserPresentationMessage({
          currentUserMessage,
          sessionId,
          parentSessionId,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId,
        }),
        assistantMessage: {
          id: presentationMessageId,
          messageId: presentationMessageId,
          presentationMessageId,
          sessionId,
          parentSessionId,
          dialogProcessId,
          parentDialogProcessId,
          turnScopeId,
          role: "assistant",
          type: "message",
          chatPresentation: true,
          content: "",
          attachments: [],
          thinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
        },
      },
    },
  );
  emitEvent(
    eventListener,
    "agent_transport_parameters_consumed",
    buildAgentTransportConsumption({
      transportCommand: resolvedRunConfig?.transportCommand,
      identity: {
        sessionId,
        parentSessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId,
      },
      normalizedMessage,
      requestedAttachments,
      canonicalAttachments,
      currentUserMessage,
      resolvedRunConfig,
      turnCommand,
      committedTurnResult,
      dispatchRuntime,
    }),
  );
  bindCurrentTurnPersistence({
    dispatchRuntime,
    appendAgentMessages,
    getSessionTurns,
    commitSummaryCheckpoint,
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    parentDialogProcessId,
    turnScopeId,
    eventListener,
    persistenceContext,
  });
  return dispatchRuntime;
}
