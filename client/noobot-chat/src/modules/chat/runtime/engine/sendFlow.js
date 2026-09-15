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
import { createSendFlowDebugLogger } from "./sendFlowDebugLogger.js";
import { resolveSendRequest } from "./sendRequestResolver.js";
import { executeSendStream } from "./sendStreamExecutor.js";

export { shouldProjectMainSessionEvent, shouldProjectSubSessionEvent } from "./sendFlowSupport.js";

export function createChatEngineSender({
  activeSession,
  activeSessionId,
  allowUserInteraction,
  applyConversationState,
  applyConversationStateFromEvent,
  appendMessage,
  findCanonicalMessageById,
  findCanonicalMessagesById,
  materializeTurnPresentation,
  upsertCanonicalAssistantMessage,
  botScenario,
  chatWebSocketClient,
  sessionLogWebSocketClient,
  applyWorkflowRuntimeEvent,
  reduceSubSessionMessageEvent,
  classifyRealtimeLog,
  clearMissingInteractionPayloadTimer,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  clearUploads,
  ensureConnected,
  foldMessagesForView,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  input,
  interactionSubmitting,
  isImageMime,
  locale,
  makeViewMessage,
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
  const logSessionEvent = (event = {}) => sessionLogWebSocketClient?.log?.(event);
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
    activeSessionId,
    applyConversationState,
    applyConversationStateFromEvent,
    applyWorkflowRuntimeEvent,
    reduceSubSessionMessageEvent,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    foldMessagesForView,
    logSessionEvent,
    makeViewMessage,
    mergeAssistantAttachments,
    setPendingInteractionRequest,
    tryAutoResolveInteraction,
  };
  return async function send(options = {}) {
    const request = resolveSendRequest(options, {
      activeSession,
      activeSessionId,
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
      assistantMessageId,
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
    const thinkingStartedAt = new Date(turnStartedAtMs).toISOString();
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId,
      turnScopeId,
      thinkingStartedAt,
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
      applyConversationState,
      translate,
      navigateToLastMessage,
      messageText: explicitMessageText,
      turnScopeId,
      userMessageId,
      assistantMessageId,
      reuseExistingUserTurn,
      attachmentFiles: explicitAttachmentFiles,
      userAttachments: explicitUserAttachments,
      turnStartedAtMs,
    });
    debugLogger.prepareAfter({
      reuseExistingUserTurn,
      userMessageId,
      assistantMessageId,
      userMessage,
      botMessage: botMsg,
      explicitUserAttachments,
      explicitTransportAttachments,
      filesToSend,
    });

    const errorRef = { value: null };
    try {
      return await executeSendStream({
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
        errorEventData: errorRef.value || error?.data || null,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
        clearPendingInteraction,
        notify,
        translate,
      });
      debugLogger.error({
        error,
        hasStreamErrorEventData: Boolean(errorRef.value),
      });
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
