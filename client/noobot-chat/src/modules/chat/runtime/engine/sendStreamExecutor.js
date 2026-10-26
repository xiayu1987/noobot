/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSendStreamEventHandler } from "./sendStreamEventRouter.js";
import { createAuthorityResolutionTracker } from "./authorityResolutionTracker.js";
import { createTurnPayloadBuilder } from "./sendPayloadBuilder.js";

export async function executeSendStream({
  activeSession,
  applyTurnLifecycleEnvelope,
  chatWebSocketClient,
  clearUploads,
  debugLogger,
  filesToSend,
  navigateOnFirstResponseOnce,
  payloadPreferences,
  prepared,
  request,
  serializeAttachments,
  sessionAggregateVersionManager,
  streamHandlerDependencies,
  streamOutput,
  translate,
}) {
  const {
    explicitAttachmentFiles,
    explicitTransportAttachments,
    explicitUserAttachments,
    sessionId,
    turnScopeId,
  } = request;
  const { botMessage, text, userMessage } = prepared;

  if (!explicitAttachmentFiles) clearUploads();
  const attachments = explicitTransportAttachments || (await serializeAttachments(filesToSend));
  const requestedTextStreaming = streamOutput.value === true;

  const buildPayloadForCurrentVersion = createTurnPayloadBuilder({
    preferences: payloadPreferences,
    request,
    turn: {
      activeSession,
      attachments,
      requestedTextStreaming,
      text,
      uploadHint: translate("chat.uploadHint"),
      userMessage,
    },
  });
  const payload = buildPayloadForCurrentVersion({
    expectedAggregateVersion: sessionAggregateVersionManager.getVersion(),
  });
  debugLogger.streamBefore({
    requestedTextStreaming,
    attachments,
    payload,
    explicitUserAttachments,
    explicitTransportAttachments,
    filesToSend,
    botMessage,
  });
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
