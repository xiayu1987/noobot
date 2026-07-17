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
  handleStopConfirmationTimeout,
  stopSending as requestStopSending,
} from "./chatEngine/stop";
import { createMonotonicMessageActions } from "./chatEngine/monotonicMessageActions";
import { applyRunStateMessageRuntimePatch } from "./chatEngine/messageRuntimePatch";
import { createChatEngineSender } from "./chatEngine/sendFlow";
import { createPendingMessageOperationStore } from "./chatEngine/messageOperationStore";
import { applySessionRunStateEvent } from "./sessionRunStateMachine";
import { logStateMachineDebug } from "./debug/stateMachineLogger";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { applyTurnRuntimeEvent } from "./sessionRunStateMachine/turnRuntimeRegistry";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS =
  TIME_THRESHOLDS.client.monotonicActionStopTimeoutMs;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS =
  TIME_THRESHOLDS.client.monotonicActionStopPollIntervalMs;
export function useChatEngine({
  userId,
  allowUserInteraction,
  safeConfirm,
  streamOutput,
  botScenario,
  selectedModel,
  pluginModelConfig,
  selectedPlugins,
  isImageMime,
  classifyRealtimeLog,
  navigateToLastMessage,
  locateSendingStartedMessage,
  locateDoneMessage,
  activeSession,
  activeSessionId,
  sending,
  canStop,
  runStateSnapshot,
  turnRuntimeRegistry,
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
  sessionLogWebSocketClient,
  ensureConnected,
  notify = () => {},
  processStore = null,
  monotonicActionStopTimeoutMs = DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS,
  monotonicActionStopPollIntervalMs = DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS,
} = {}) {
  const { translate, locale } = useLocale();
  const applyRunStateEvent = (event) => {
    applyTurnRuntimeEvent(turnRuntimeRegistry?.value, event, {
      fallbackSessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || activeSessionId?.value || ""),
    });
    const previousRunState = runStateSnapshot?.value?.state || "";
    logStateMachineDebug("stateMachine.event", {
      eventType: event?.type || "",
      sessionId: event?.sessionId || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      fromState: previousRunState,
    });
    sessionLogWebSocketClient?.log?.({
      category: "state",
      event: "stateMachine.event",
      sessionId: event?.sessionId || activeSessionId?.value || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      data: {
        eventType: event?.type || "",
        source: event?.source || "",
        fromState: previousRunState,
      },
    });
    const result = applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      sending,
      canStop,
      event,
    });
    logStateMachineDebug("stateMachine.transition", {
      eventType: event?.type || "",
      fromState: previousRunState,
      toState: runStateSnapshot?.value?.state || "",
      sending: sending?.value === true,
      canStop: canStop?.value === true,
      messageCount: Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages.length : 0,
    });
    sessionLogWebSocketClient?.log?.({
      category: "state",
      event: "stateMachine.transition",
      sessionId: event?.sessionId || activeSessionId?.value || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      data: {
        eventType: event?.type || "",
        fromState: previousRunState,
        toState: runStateSnapshot?.value?.state || "",
        sending: sending?.value === true,
        canStop: canStop?.value === true,
        messageCount: Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages.length : 0,
      },
    });
    applyRunStateMessageRuntimePatch({
      activeSession,
      runStateSnapshot,
    });
    return result;
  };
  const {
    applyAssistantFailureState,
    mergeAssistantAttachments,
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
    runStateSnapshot,
    turnRuntimeRegistry,
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

  function onStopConfirmationTimeout(stopScope = {}) {
    return handleStopConfirmationTimeout({
      sending,
      canStop,
      runStateSnapshot,
      applyRunStateEvent,
      activeSession,
      findTargetAssistantMessage,
      applyConversationState,
      chatWebSocketClient,
      stopScope,
    });
  }

  function stopSending() {
    return requestStopSending({
      userId,
      activeSession,
      turnRuntimeRegistry,
      chatWebSocketClient,
      onStopConfirmationTimeout,
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
    applyAssistantFailureState,
    applySessionDetail,
    appendMessage,
    botScenario,
    chatWebSocketClient,
    sessionLogWebSocketClient,
    classifyRealtimeLog,
    clearMissingInteractionPayloadTimer,
    clearPendingInteraction,
    clearUploads,
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    ensureConnected,
    fetchSessionDetail,
    foldMessagesForView,
    safeConfirm,
    input,
    interactionSubmitting,
    isImageMime,
    locale,
    locateSendingStartedMessage,
    locateDoneMessage,
    makeViewMessage,
    mergeAssistantAttachments,
    notify,
    pendingInteractionRequest,
    pluginModelConfig,
    refreshSessionConnectorsAsync,
    navigateToLastMessage,
    selectedModel,
    selectedPlugins,
    sending,
    canStop,
    runStateSnapshot,
    turnRuntimeRegistry,
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
    canStop,
    stopSending,
    translate,
    userId,
    applySessionDetail,
    fetchSessionDetail,
    applyRunStateEvent,
    turnRuntimeRegistry,
    messageOperationStore,
    monotonicActionStopTimeoutMs,
    monotonicActionStopPollIntervalMs,
    appendMessage,
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
