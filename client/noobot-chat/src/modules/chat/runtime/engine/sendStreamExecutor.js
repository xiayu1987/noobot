/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { createSendStreamEventHandler } from "./sendStreamEventRouter.js";
import { createAuthorityResolutionTracker } from "./authorityResolutionTracker.js";
import { createTurnPayloadBuilder } from "./sendPayloadBuilder.js";

export async function executeSendStream({
  activeSession,
  applyTurnLifecycleEnvelope,
  chatWebSocketClient,
  clearUploads,
  debugLogger,
  navigateOnFirstResponseOnce,
  payloadPreferences,
  prepared,
  request,
  serializeAttachments,
  sessionAggregateVersionManager,
  streamHandlerDependencies,
  streamOutput,
}) {
  const { sessionId, turnScopeId } = request;
  const { botMessage } = prepared;

  if (request.commandType !== AGENT_COMMAND.RESEND) clearUploads();
  const attachments =
    request.commandType === AGENT_COMMAND.RESEND
      ? request.attachments
      : await serializeAttachments(request.attachmentFiles);
  const requestedTextStreaming = streamOutput.value === true;

  const buildPayloadForCurrentVersion = createTurnPayloadBuilder({
    preferences: payloadPreferences,
    request,
    turn: {
      activeSession,
      attachments,
      requestedTextStreaming,
    },
  });
  const payload = buildPayloadForCurrentVersion({
    expectedAggregateVersion: sessionAggregateVersionManager.getVersion(),
  });
  debugLogger.streamBefore({ request, requestedTextStreaming, attachments, payload, botMessage });
  const authorityResolutions = createAuthorityResolutionTracker({ applyTurnLifecycleEnvelope });
  const handleStreamEvent = createSendStreamEventHandler({
    ...streamHandlerDependencies,
    applyTurnLifecycleEnvelope: authorityResolutions.applyTrackedTurnLifecycleEnvelope,
    botMessage,
    navigateOnFirstResponseOnce,
    sessionId,
    turnScopeId,
  });
  await sessionAggregateVersionManager.runAggregateVersionedStream({
    buildPayload: buildPayloadForCurrentVersion,
    stream: (streamPayload) => chatWebSocketClient.stream(streamPayload, handleStreamEvent),
    conflictOptions: {
      sessionId,
      logContext: { turnScopeId },
    },
  });

  await authorityResolutions.drain();
  debugLogger.resolved({ botMessage });
  return true;
}
