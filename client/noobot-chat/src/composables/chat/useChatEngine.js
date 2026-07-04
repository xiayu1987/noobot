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
import {
  applySessionRunStateEvent,
  resolveSessionRunMessageRuntimePatch,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "./sessionRunStateMachine";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "./debug/stateMachineLogger";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_MONOTONIC_ACTION_STOP_TIMEOUT_MS =
  TIME_THRESHOLDS.client.monotonicActionStopTimeoutMs;
const DEFAULT_MONOTONIC_ACTION_STOP_POLL_INTERVAL_MS =
  TIME_THRESHOLDS.client.monotonicActionStopPollIntervalMs;
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
  locateSendingStartedMessage,
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
  const applyRunStateMessagePatch = (message, patch = {}) => {
    if (!message || !patch || typeof patch !== "object") return;
    const {
      clearRuntimeMark,
      thinkingStartedAtPolicy,
      thinkingFinishedAtPolicy,
      statusLabelPolicy,
      ...restPatch
    } = patch;

    Object.entries(restPatch).forEach(([key, value]) => {
      if (key === "thinkingStartedAt" && thinkingStartedAtPolicy === "if_missing") {
        if (!message.thinkingStartedAt) message.thinkingStartedAt = value;
        return;
      }
      if (key === "thinkingFinishedAt" && thinkingFinishedAtPolicy === "if_missing") {
        if (!message.thinkingFinishedAt) message.thinkingFinishedAt = value;
        return;
      }
      if (key === "statusLabelKey" && statusLabelPolicy === "if_empty") {
        if (!message.statusLabelKey && !message.statusLabel) message.statusLabelKey = value;
        return;
      }
      if (key === "channelState" && value && typeof value === "object" && !Array.isArray(value)) {
        message.channelState = {
          ...(message.channelState && typeof message.channelState === "object" && !Array.isArray(message.channelState)
            ? message.channelState
            : {}),
          ...value,
        };
        return;
      }
      message[key] = value;
    });

    if (clearRuntimeMark) {
      delete message[SESSION_RUN_MESSAGE_RUNTIME_MARK];
      delete message.runtimeMark;
    }
    logStateMachineDebug("stateMachine.messageRuntimePatch.apply", {
      message: summarizeStateMachineMessage(message),
      pending: message?.pending === true,
      channelState: message?.channelState?.state || "",
      hasRuntimeMark: Boolean(message?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message?.runtimeMark),
      clearRuntimeMark: clearRuntimeMark === true,
      patchChannelState: patch?.channelState?.state || "",
      patchPending: patch?.pending,
      statusLabelKey: patch?.statusLabelKey || "",
    });
  };
  const applyRunStateMessageRuntimePatch = () => {
    const session = activeSession?.value;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    if (!messages.length) return;
    messages.forEach((message) => {
      const effect = resolveSessionRunMessageRuntimePatch({
        stateSnapshot: runStateSnapshot?.value,
        messageItem: message,
        activeSession: session,
      });
      logStateMachineDebug("stateMachine.messageRuntimePatch.effect", {
        runState: runStateSnapshot?.value?.state || "",
        eventType: runStateSnapshot?.value?.sourceEvent || "",
        message: summarizeStateMachineMessage(message),
        hasRuntimeMark: Boolean(message?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message?.runtimeMark),
        effectAction: effect?.action || "",
        effectReason: effect?.reason || "",
        patchChannelState: effect?.patch?.channelState?.state || "",
        clearRuntimeMark: effect?.patch?.clearRuntimeMark === true,
      });
      if (effect?.action !== SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE) return;
      applyRunStateMessagePatch(message, effect.patch);
    });
  };
  const applyRunStateEvent = (event) => {
    const previousRunState = runStateSnapshot?.value?.state || "";
    logStateMachineDebug("stateMachine.event", {
      eventType: event?.type || "",
      sessionId: event?.sessionId || "",
      dialogProcessId: event?.dialogProcessId || "",
      turnScopeId: event?.turnScopeId || "",
      fromState: previousRunState,
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
    applyRunStateMessageRuntimePatch();
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
    locateSendingStartedMessage,
    locateDoneMessage,
    makeViewMessage,
    mergeAssistantAttachments,
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
    canStop,
    stopSending,
    translate,
    userId,
    applySessionDetail,
    fetchSessionDetail,
    applyRunStateEvent,
    runStateSnapshot,
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
