/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireFunctionDependencies } from "@noobot/shared/value";
import { createSessionAggregateVersionManager } from "./sessionAggregateVersionManager.js";
import { applySendErrorState, finalizeSendCleanup } from "./sendFinalize.js";
import { prepareChatSend } from "./sendPrepare.js";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine.js";
import {
  projectTurnRuntimeView,
  selectTurnRuntimeByScope,
} from "../run-state-machine/turnRuntimeRegistry.js";
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
  notify,
  pendingInteractionRequest,
  pluginModelConfig,
  frontendThresholdsEnabled,
  summaryPolicy,
  requestTurnNavigation,
  memoryModel,
  selectedModel,
  selectedPlugins,
  turnRuntimeRegistry,
  applyRunStateEvent,
  applyTurnLifecycleEnvelope,
  serializeAttachments,
  streamOutput,
  translate,
  setPendingInteractionRequest,
  uploadFiles,
}) {
  requireFunctionDependencies("createChatEngineSender", {
    requestTurnNavigation,
    applyRunStateEvent,
    logSession: sessionLogWebSocketClient.log,
  });
  const logSessionEvent = (event) => sessionLogWebSocketClient.log(scopeSessionLogRecord(event));
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
    setPendingInteractionRequest,
  };
  return async function send(sendRequest) {
    const request = resolveSendRequest(sendRequest, {
      activeSession,
      ensureConnected,
      input,
      uploadFiles,
      translate,
    });
    if (!request) return false;
    const { sessionId, turnScopeId } = request;
    const runtimeView = () =>
      projectTurnRuntimeView(
        sessionId,
        selectTurnRuntimeByScope(turnRuntimeRegistry.value, sessionId, turnScopeId),
      );
    const debugLogger = createSendFlowDebugLogger({
      activeSession,
      logSessionEvent,
      runtimeView,
      sessionId,
      turnRuntimeRegistry,
      turnScopeId,
    });
    debugLogger.begin({ request });
    const turnStartedAtMs = Date.now();
    const startedAt = new Date(turnStartedAtMs).toISOString();
    applyRunStateEvent({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId,
      turnScopeId,
      startedAt,
      source: "send_flow",
    });
    const {
      userMessage,
      botMessage: botMsg,
      navigateOnFirstResponseOnce,
    } = prepareChatSend({
      request,
      input,
      isImageMime,
      appendMessage,
      upsertCanonicalAssistantMessage,
      activeSession,
      translate,
      requestTurnNavigation,
    });
    debugLogger.prepareAfter({ request, userMessage, botMessage: botMsg });

    try {
      return await executeSendStream({
        activeSession,
        applyTurnLifecycleEnvelope,
        chatWebSocketClient,
        clearUploads,
        debugLogger,
        navigateOnFirstResponseOnce,
        payloadPreferences,
        prepared: { botMessage: botMsg, userMessage },
        request,
        serializeAttachments,
        sessionAggregateVersionManager,
        streamHandlerDependencies,
        streamOutput,
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
