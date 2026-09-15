/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSendStreamEventHandler } from "./sendStreamEventRouter.js";
import { createAuthorityResolutionTracker } from "./authorityResolutionTracker.js";
import { createTurnPayloadBuilder } from "./sendPayloadBuilder.js";

function createStreamStateView(errorRef) {
  return {
    get lastStreamErrorEventData() {
      return errorRef.value;
    },
    set lastStreamErrorEventData(value) {
      errorRef.value = value;
    },
  };
}

/**
 * 执行一次发送的流式阶段：附件序列化、payload 装配、事件处理器组装与聚合版本化流。
 * lastStreamErrorEventData 通过 errorRef 显式共享给调用方的 catch 分支。
 */
export async function executeSendStream({
  activeSession,
  applyRunStateEvent,
  applyTurnLifecycleEnvelope,
  chatWebSocketClient,
  clearUploads,
  debugLogger,
  errorRef,
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
  const requestedTextStreaming = streamOutput?.value === true;

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
  const authorityResolutions = createAuthorityResolutionTracker({
    applyRunStateEvent,
    applyTurnLifecycleEnvelope,
  });
  const handleStreamEvent = createSendStreamEventHandler({
    ...streamHandlerDependencies,
    applyRunStateEvent: authorityResolutions.applyTrackedRunStateEvent,
    applyTurnLifecycleEnvelope: authorityResolutions.applyTrackedTurnLifecycleEnvelope,
    botMessage,
    navigateOnFirstResponseOnce,
    requestedTextStreaming,
    sessionId,
    streamState: createStreamStateView(errorRef),
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
