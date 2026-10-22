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
import { syncLifecycleRuntimeState } from "../../../runtime/lifecycle/state-machine.js";
import { initializeAgentModelHost } from "../../../runtime/model-port-host.js";
import { buildAgentTransportConsumption } from "./agent-transport-consumption.js";
import { bindCurrentTurnPersistence } from "./current-turn-persistence.js";
import { appendUserInterjectionMessage } from "../../../runtime/turn/turn-context-message-appender.js";
import { text, isObjectLike } from "@noobot/shared/value";

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
  return {
    messageUid: text(currentUserMessage?.messageUid),
    userMessageId: text(currentUserMessage?.userMessageId),
    sessionId,
    parentSessionId,
    dialogProcessId,
    parentDialogProcessId,
    turnScopeId,
    role: "user",
    type: text(currentUserMessage?.type) || "message",
    content: String(currentUserMessage?.content || ""),
    attachments: projectPresentationAttachments(currentUserMessage?.attachments),
    messageOrigin: text(currentUserMessage?.messageOrigin).toLowerCase(),
    ts: currentUserMessage?.ts,
  };
}

export async function bindAgentDispatchRuntime({
  runtimeAgentContext,
  lifecycle,
  presentationMessageId,
  userMessageAttachments,
  appendAgentMessages,
  commitSummaryCheckpoint,
  userId,
  sessionId,
  parentSessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
  eventListener,
  persistenceScope,
  sessionDir,
  normalizedMessage,
  requestedAttachments,
  canonicalAttachments,
  currentUserMessage,
  resolvedRunConfig,
  userInterjectionPort,
  committedTurnResult,
}) {
  const dispatchRuntime = runtimeAgentContext?.bindings?.runtime;
  if (!isObjectLike(dispatchRuntime)) {
    throw new TypeError("agent dispatch binding requires runtimeAgentContext.bindings.runtime");
  }

  dispatchRuntime.eventListener = eventListener;
  const { systemRuntime } = dispatchRuntime;
  systemRuntime.sessionId = sessionId;
  systemRuntime.dialogProcessId = dialogProcessId;
  systemRuntime.turnScopeId = turnScopeId;
  systemRuntime.sessionDir = text(sessionDir);
  dispatchRuntime.currentUserMessageUid = text(currentUserMessage?.messageUid);
  dispatchRuntime.currentUserMessageOrigin = text(currentUserMessage?.messageOrigin).toLowerCase();
  dispatchRuntime.userInterjectionPort = userInterjectionPort;

  initializeAgentModelHost({
    runtime: dispatchRuntime,
    invocationIdentity: getAgentContextEnvelope(runtimeAgentContext).identity,
  });
  bindAssistantMessageEventStream(dispatchRuntime, {
    presentationMessageId,
    parentSessionId,
    workflowRunId: text(resolvedRunConfig.workflowRunId),
    nodeExecutionId: text(resolvedRunConfig.workflowNodeExecutionId),
  });
  applyRuntimeUserMessageAttachments(dispatchRuntime, userMessageAttachments);
  syncLifecycleRuntimeState(dispatchRuntime, lifecycle);
  initializeCurrentTurnMessageEventProjection(dispatchRuntime);
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
          thinkingStartedAt: text(resolvedRunConfig?.thinkingStartedAt),
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
      committedTurnResult,
      dispatchRuntime,
    }),
  );
  bindCurrentTurnPersistence({
    dispatchRuntime,
    appendAgentMessages,
    commitSummaryCheckpoint,
    userId,
    sessionId,
    dialogProcessId,
    parentDialogProcessId,
    turnScopeId,
    eventListener,
    persistenceScope,
  });
  dispatchRuntime.consumeUserInterjections = async () => {
    if (!dispatchRuntime.userInterjectionPort) return [];
    return dispatchRuntime.userInterjectionPort.consume(async (interjections) => {
      await dispatchRuntime.withCurrentTurnPersistenceBatch(async () => {
        for (const interjection of interjections) {
          appendUserInterjectionMessage({ runtime: dispatchRuntime, interjection });
        }
        await dispatchRuntime.persistCurrentTurnMessages();
      });
    });
  };
  dispatchRuntime.sealUserInterjectionQueueIfEmpty = () =>
    dispatchRuntime.userInterjectionPort?.sealIfEmpty?.() !== false;
  return dispatchRuntime;
}
