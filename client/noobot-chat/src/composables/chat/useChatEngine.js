/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";
import { createAssistantMessageHelpers } from "./chatEngine/assistantMessage";
import { createChatEngineConversationState } from "./chatEngine/conversationState";
import {
  forceStopUiFinalize as finalizeForceStopUi,
  stopSending as requestStopSending,
} from "./chatEngine/stop";
import { createMonotonicMessageActions } from "./chatEngine/monotonicMessageActions";
import { createChatEngineSender } from "./chatEngine/sendFlow";
import { createPendingMessageOperationStore } from "./chatEngine/messageOperationStore";
import { applySessionRunStateEvent } from "./sessionRunStateMachine";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS = 3000;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS = 50;
export function useChatEngine({
  userId,
  allowUserInteraction,
  forceTool,
  streamOutput,
  botScenario,
  selectedModel,
  pluginModelConfig,
  selectedPlugins,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  locateDoneMessage,
  activeSession,
  activeSessionId,
  sending,
  canStop,
  runStateSnapshot,
  input,
  uploadFiles,
  clearUploads,
  serializeAttachments,
  appendMessage,
  makeViewMessage,
  foldMessagesForView,
  fetchSessionDetail,
  applySessionDetail,
  refreshSessionConnectorsAsync,
  deleteSessionMessagesFromApi,
  replaceSessionTurnApi,
  authFetch,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  pendingInteractionRequest,
  interactionSubmitting,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  submitInteractionResponse,
  refreshSessionsAsync,
  onConversationState,
  chatWebSocketClient,
  ensureConnected,
  notify = () => {},
  processStore = null,
  monotonicActionStopTimeoutMs = DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS,
  monotonicActionStopPollIntervalMs = DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS,
} = {}) {
  const { translate, locale } = useLocale();
  const applyRunStateEvent = (event) => applySessionRunStateEvent({
    stateRef: runStateSnapshot,
    sending,
    canStop,
    event,
  });
  const {
    applyAssistantFailureState,
    mergeAssistantAttachmentMetas,
  } = createAssistantMessageHelpers({
    translate,
    makeViewMessage,
  });

  const {
    applyConversationState,
    applyConversationStateFromEvent,
    clearMissingInteractionPayloadTimer,
    disposeConversationState,
    findTargetAssistantMessage,
    tryAutoResolveInteraction,
  } = createChatEngineConversationState({
    activeSession,
    activeSessionId,
    sending,
    canStop,
    applyRunStateEvent,
    interactionSubmitting,
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
    refreshSessionsAsync,
    onConversationState,
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync,
    notify,
    translate,
    applyAssistantFailureState,
  });

  function forceStopUiFinalize() {
    return finalizeForceStopUi({
      sending,
      canStop,
      runStateSnapshot,
      applyRunStateEvent,
      activeSession,
      findTargetAssistantMessage,
      applyConversationState,
      chatWebSocketClient,
    });
  }

  function stopSending() {
    return requestStopSending({
      sending,
      canStop,
      userId,
      activeSession,
      chatWebSocketClient,
      onForceStopUiFinalize: forceStopUiFinalize,
      applyRunStateEvent,
    });
  }

  let monotonicMessageActions;
  const messageOperationStore = createPendingMessageOperationStore();
  const send = createChatEngineSender({
    activeSession,
    activeSessionId,
    allowUserInteraction,
    applyConversationState,
    applyConversationStateFromEvent,
    applySessionDetail,
    appendMessage,
    botScenario,
    chatWebSocketClient,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    clearUploads,
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    ensureConnected,
    fetchSessionDetail,
    foldMessagesForView,
    forceTool,
    input,
    interactionSubmitting,
    isImageMime,
    locale,
    locateDoneMessage,
    makeViewMessage,
    mergeAssistantAttachmentMetas,
    notify,
    pendingInteractionRequest,
    pluginModelConfig,
    refreshSessionConnectorsAsync,
    scrollBottom,
    selectedModel,
    selectedPlugins,
    sending,
    canStop,
    applyRunStateEvent,
    serializeAttachments,
    streamOutput,
    translate,
    tryAutoResolveInteraction,
    setPendingInteractionRequest,
    uploadFiles,
    userId,
    processStore,
    finalizePendingResendOperation: (...args) => monotonicMessageActions?.finalizePendingResendOperation?.(...args),
  });


  monotonicMessageActions = createMonotonicMessageActions({
    activeSession,
    activeSessionId,
    authFetch,
    clearPendingInteraction,
    deleteSessionMessagesFromApi,
    replaceSessionTurnApi,
    input,
    notify,
    send,
    sending,
    stopSending,
    translate,
    userId,
    applySessionDetail,
    messageOperationStore,
    monotonicActionStopTimeoutMs,
    monotonicActionStopPollIntervalMs,
  });
  const {
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage,
  } = monotonicMessageActions;

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposeConversationState();
      messageOperationStore.clearSession(activeSessionId?.value);
    });
  }

  return {
    send,
    stopSending,
    prepareMonotonicMessageAction,
    resolveMonotonicUserTarget,
    cascadeDeleteMessagesFrom,
    deleteMonotonicMessage,
    resendMonotonicMessage,
  };
}
