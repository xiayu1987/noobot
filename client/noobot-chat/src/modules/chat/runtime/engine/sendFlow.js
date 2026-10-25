/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionAggregateVersionManager } from "./sessionAggregateVersionManager.js";
import { applySendErrorState, finalizeSendCleanup } from "./sendFinalize.js";
import { prepareChatSend } from "./sendPrepare.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import { selectSessionTurnRuntime } from "../run-state-machine/turnRuntimeRegistry.js";
import { logResendDebug } from "../../../debug/loggers/resendDebugLogger.js";
import { scopeSessionLogRecord } from "../../../debug/loggers/lazyDebugSink.js";
import { createSendFlowDebugLogger } from "./sendFlowDebugLogger.js";
import { resolveSendRequest } from "./sendRequestResolver.js";
import { executeSendStream } from "./sendStreamExecutor.js";

export function createChatEngineSender({
  activeSession,
  allowUserInteraction,
  applyConversationState,
  appendMessage,
  findSession,
  findUserMessageForCommit,
  findMessagesByPresentationId,
  materializeTurnPresentation,
  upsertCanonicalAssistantMessage,
  botScenario,
  chatWebSocketClient,
  sessionLogWebSocketClient,
  applyWorkflowRuntimeEvent,
  reduceSubSessionMessageEvent,
  clearMissingInteractionPayloadTimer,
  clearPendingInteraction,
  clearUploads,
  ensureConnected,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  input,
  interactionSubmitting,
  isImageMime,
  locale,
  makeViewMessage,
  makeViewAttachments,
  mergeAssistantAttachments,
  notify,
  pendingInteractionRequest,
  pluginModelConfig,
  frontendThresholdsEnabled,
  summaryPolicy,
  navigateToLastMessage,
  memoryModel,
  selectedModel,
  selectedPlugins,
  turnRuntimeRegistry,
  applyRunStateEvent,
  applyTurnLifecycleEnvelope,
  serializeAttachments,
  streamOutput,
  translate,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
  uploadFiles,
}) {
  const logSessionEvent = (event = {}) =>
    sessionLogWebSocketClient?.log?.(scopeSessionLogRecord(event));
  const sessionAggregateVersionManager = createSessionAggregateVersionManager({
    activeSession,
    log: logResendDebug,
  });
  const payloadPreferences = {
    allowUserInteraction,
    safeConfirm,
    safeConfirmLevel,
    sanitizeOutput,
    botScenario,
    selectedModel,
    memoryModel,
    pluginModelConfig,
    frontendThresholdsEnabled,
    summaryPolicy,
    locale,
    selectedPlugins,
  };
  const streamHandlerDependencies = {
    activeSession,
    applyConversationState,
    applyWorkflowRuntimeEvent,
    reduceSubSessionMessageEvent,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    findSession,
    findUserMessageForCommit,
    findMessagesByPresentationId,
    materializeTurnPresentation,
    logSessionEvent,
    makeViewMessage,
    makeViewAttachments,
    mergeAssistantAttachments,
    setPendingInteractionRequest,
    tryAutoResolveInteraction,
  };
  return async function send(options = {}) {
    const request = resolveSendRequest(options, {
      activeSession,
      ensureConnected,
      input,
      turnRuntimeRegistry,
      uploadFiles,
    });
    if (!request) return false;
    const {
      explicitMessageText,
      explicitAttachmentFiles,
      explicitUserAttachments,
      explicitTransportAttachments,
      hasTextToSend,
      allowDuringResend,
      reuseExistingUserTurn,
      turnScopeId,
      userMessageId,
      presentationMessageId,
      sessionId,
    } = request;
    const runtimeView = () =>
      selectSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId, turnScopeId);
    const debugLogger = createSendFlowDebugLogger({
      activeSession,
      logSessionEvent,
      runtimeView,
      sessionId,
      turnRuntimeRegistry,
      turnScopeId,
    });
    debugLogger.begin({
      reuseExistingUserTurn,
      allowDuringResend,
      hasText: hasTextToSend,
      uploadCount: explicitAttachmentFiles?.length ?? uploadFiles.value.length,
    });
    const turnStartedAtMs = Date.now();
    const startedAt = new Date(turnStartedAtMs).toISOString();
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId,
      turnScopeId,
      startedAt,
      source: "send_flow",
    });
    const {
      text,
      filesToSend,
      userMessage,
      botMessage: botMsg,
      navigateOnFirstResponseOnce,
    } = prepareChatSend({
      input,
      uploadFiles,
      isImageMime,
      appendMessage,
      upsertCanonicalAssistantMessage,
      activeSession,
      translate,
      navigateToLastMessage,
      sessionId,
      messageText: explicitMessageText,
      turnScopeId,
      userMessageId,
      presentationMessageId,
      reuseExistingUserTurn,
      attachmentFiles: explicitAttachmentFiles,
      userAttachments: explicitUserAttachments,
    });
    debugLogger.prepareAfter({
      reuseExistingUserTurn,
      userMessageId,
      presentationMessageId,
      userMessage,
      botMessage: botMsg,
      explicitUserAttachments,
      explicitTransportAttachments,
      filesToSend,
    });

    try {
      return await executeSendStream({
        activeSession,
        applyTurnLifecycleEnvelope,
        chatWebSocketClient,
        clearUploads,
        debugLogger,
        filesToSend,
        navigateOnFirstResponseOnce,
        payloadPreferences,
        prepared: { botMessage: botMsg, text, userMessage },
        request,
        serializeAttachments,
        sessionAggregateVersionManager,
        streamHandlerDependencies,
        streamOutput,
        translate,
      });
    } catch (error) {
      applySendErrorState({
        error,
        botMessage: botMsg,
        clearPendingInteraction,
        notify,
        translate,
      });
      debugLogger.error({ error });
      return false;
    } finally {
      finalizeSendCleanup({
        pendingInteractionRequest,
        interactionSubmitting,
      });
      debugLogger.cleanup({
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  };
}
