/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";
import { applyRunStateMessageRuntimePatch } from "./chatEngine/messageRuntimePatch";
import { createAssistantMessageHelpers } from "./chatEngine/assistantMessage";
import { createChatEngineConversationState } from "./chatEngine/conversationState";
import {
  handleStopConfirmationTimeout,
  stopSending as requestStopSending,
} from "./chatEngine/stop";
import { createMonotonicMessageActions } from "./chatEngine/monotonicMessageActions";
import { createChatEngineSender } from "./chatEngine/sendFlow";
import { createPendingMessageOperationStore } from "./chatEngine/messageOperationStore";
import { logStateMachineDebug } from "./debug/stateMachineLogger";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { selectSessionTurnRuntime } from "./sessionRunStateMachine/turnRuntimeRegistry";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS =
  TIME_THRESHOLDS.client.monotonicActionStopTimeoutMs;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS =
  TIME_THRESHOLDS.client.monotonicActionStopPollIntervalMs;
export function useChatEngine({
  userId,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
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
  sessions,
  turnRuntimeRegistry,
  applyTurnRuntimeEvent,
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
  upsertWorkflowNodeStateEvent,
  upsertWorkflowPlanningEvent,
  upsertSubSessionEvent,
  ensureConnected,
  notify = () => {},
  processStore = null,
  runtimeEventsAlreadyProjected = false,
  monotonicActionStopTimeoutMs = DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS,
  monotonicActionStopPollIntervalMs = DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS,
} = {}) {
  const { translate, locale } = useLocale();
  const applyRunStateEvent = (event) => {
    const turnResult = applyTurnRuntimeEvent?.(event);
    const runtime = selectSessionTurnRuntime(
      turnRuntimeRegistry?.value,
      turnResult?.turn?.sessionId || event?.sessionId || "",
    );
    logStateMachineDebug("stateMachine.event", {
      eventType: event?.type || "",
      sessionId: event?.sessionId || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      toState: runtime.displayState,
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
        toState: runtime.displayState,
      },
    });
    logStateMachineDebug("stateMachine.transition", {
      eventType: event?.type || "",
      toState: runtime.displayState,
      sending: runtime.sending,
      canStop: runtime.canStop,
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
        toState: runtime.displayState,
        sending: runtime.sending,
        canStop: runtime.canStop,
        messageCount: Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages.length : 0,
      },
    });
    // Standalone engine consumers own their projection here. The application
    // composition root passes an already-projecting submitter and opts out, so
    // production still has exactly one projection per Registry transition.
    if (!runtimeEventsAlreadyProjected) {
      applyRunStateMessageRuntimePatch({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        event: turnResult?.turn || event,
      });
    }
    return turnResult;
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
      applyRunStateEvent,
      activeSession,
      findTargetAssistantMessage,
      applyConversationState,
      chatWebSocketClient,
      stopScope,
    });
  }

  function stopSending(executionId = "") {
    return requestStopSending({
      userId,
      activeSession,
      turnRuntimeRegistry,
      chatWebSocketClient,
      onStopConfirmationTimeout,
      applyRunStateEvent,
      executionId,
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
    upsertWorkflowNodeStateEvent,
    upsertWorkflowPlanningEvent,
    upsertSubSessionEvent,
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
    safeConfirmLevel,
    sanitizeOutput,
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
