/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { normalizeTimePair, nowMs } from "../model/timeFields.js";
import {
  buildChatWebSocketUrl,
  buildLogWebSocketUrl,
  deleteSessionApi,
  deleteSessionMessagesFromApi,
  getSessionConnectorsApi,
  getSessionDetailApi,
  getSessionThinkingDetailApi,
  getSessionsApi,
  putSessionConnectorSelectionApi,
  replaceSessionTurnApi,
  renameSessionApi,
} from "../../../infrastructure/api/chat/chatApi.js";
import { encryptPayloadBySessionId } from "../../../shared/utils/sessionCrypto.js";
import { listUserConnectors } from "../../../infrastructure/api/connectors/connectorApi.js";
import { RoleEnum } from "../model/chatConstants.js";
import {
  createConnectorPanelState,
  generateSessionId,
  sessionTitleFromMessages,
} from "../../session/model/sessionModel.js";
import { createChatWebSocketClient } from "../../../infrastructure/websocket/chatWebSocketClient.js";
import { createSessionLogWebSocketClient } from "../../../infrastructure/websocket/sessionLogWebSocketClient.js";
import { useChatInput } from "./useChatInput.js";
import { useAgentInteraction } from "./useAgentInteraction.js";
import { useConnectorPanel } from "../../composer/composables/useConnectorPanel.js";
import { useChatList } from "./useChatList.js";
import { useChatEngine } from "./useChatEngine.js";
import { useReconnectReplay } from "./useReconnectReplay.js";
import { useChatStore } from "../stores/useChatStore.js";
import { useProcessStore } from "../stores/useProcessStore.js";
import { hydrateSessionDetailExtensions } from "../../../extensions/session-detail-hydrator.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../model/messageIdentity.js";
import {
  BackendChannelState,
  clearRememberedStopRequests,
  evaluateSessionRunState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  isAuthoritativeTerminalState,
  isLegacyTerminalDiscoveryState,
} from "../runtime/sessionRunStateMachine.js";
import {
  logStateMachineDebug,
  setStateMachineDebugLogSink,
  summarizeStateMachineTurn,
} from "../../debug/loggers/stateMachineLogger.js";
import { setResendDebugLogSink } from "../../debug/loggers/resendDebugLogger.js";
import { setStopDebugLogSink } from "../../debug/loggers/stopDebugLogger.js";
import { setStopContinueDebugLogSink } from "../../debug/loggers/stopContinueDebugLogger.js";
import { setReconnectTimingDebugLogSink } from "../../debug/loggers/reconnectTimingDebugLogger.js";
import { setWorkflowDiagnosticsLogSink } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  logThinkingReplayDebug,
  setThinkingReplayDebugLogSink,
} from "../../debug/loggers/thinkingReplayDebugLogger.js";
import { setToolLogWindowDebugLogSink } from "../../debug/loggers/toolLogWindowDebugLogger.js";
import { setTerminalResolutionDebugLogSink } from "../../debug/loggers/terminalResolutionDebugLogger.js";
import {
  resolveSessionTurnRuntime,
  resolveLatestContinuableStoppedTurn,
  sessionRuntimeId,
  isTurnRuntimeDeleted,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import {
  closeMobileSidebarOnSelect,
  createSessionMessageView,
} from "../runtime/session/messageView.js";
import { createComposerRuntimeState } from "../runtime/session/composerRuntimeState.js";
import { createComposerActions } from "../runtime/session/composerActions.js";
import { createReconnectCoordinator } from "../runtime/session/reconnectCoordinator.js";
import { installSessionLifecycleHydration } from "../runtime/session/sessionLifecycleHydration.js";
import { createRuntimeEventProjector } from "../runtime/session/runtimeEventProjector.js";

export function useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  streamOutput,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  frontendThresholdsEnabled,
  summaryPolicy,
  selectedPlugins,
  connected,
  ensureConnected,
  authFetch,
  refreshAuthentication = null,
  isImageMime,
  classifyRealtimeLog,
  navigateToLastMessage,
  locateSendingStartedMessage,
  locateDoneMessage,
  notify = () => {},
  clearUploadSelection = () => {},
}) {
  const { translate } = useLocale();
  const chatStore = useChatStore();
  const processStore = useProcessStore();
  const {
    turnRuntimeRegistry,
    workflowNodeStateRegistry,
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
  } = storeToRefs(chatStore);
  const conversationStateSnapshot = ref({});
  const conversationStateTimeline = ref([]);
  const pendingStoppedSummaryReconciliations = new Map();
  const pendingTerminalResolutionDiscoveries = new Map();
  let resolveDiscoveredTerminalTurn = null;
  function resolveActiveSessionIdentity() {
    const sessionId = String(activeSession.value?.sessionId || activeSessionId.value || "").trim();
    return sessionId;
  }

  function resolveActiveTurnScopeIdentity() {
    const sessionId = resolveActiveSessionIdentity();
    const activeTurn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId);
    const continuableStoppedTurn = !activeTurn
      ? resolveLatestContinuableStoppedTurn(turnRuntimeRegistry.value, sessionId)
      : null;
    return String(activeTurn?.turnScopeId || continuableStoppedTurn?.turnScopeId || "").trim();
  }

  function scheduleTerminalResolution(sessionId, turnScopeId, metadata = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedSessionId || !normalizedTurnScopeId) return;
    const key = `${normalizedSessionId}::${normalizedTurnScopeId}`;
    const resolutionMetadata = { ...metadata };
    logThinkingReplayDebug("frontend.lifecycle.terminalDiscoveryScheduled", () => ({
      sessionId: normalizedSessionId,
      turnScopeId: normalizedTurnScopeId,
      source: resolutionMetadata.source || "",
      revision: Number(resolutionMetadata.revision || 0),
      sequence: Number(resolutionMetadata.sequence || 0),
      state: resolutionMetadata.state || "",
      executionState: resolutionMetadata.executionState || "",
      startedAt: resolutionMetadata.startedAt || "",
      finishedAt: resolutionMetadata.finishedAt || "",
      resolverReady: Boolean(resolveDiscoveredTerminalTurn),
    }));
    if (resolveDiscoveredTerminalTurn) {
      void resolveDiscoveredTerminalTurn(
        normalizedSessionId,
        normalizedTurnScopeId,
        resolutionMetadata,
      );
      return;
    }
    pendingTerminalResolutionDiscoveries.set(key, {
      sessionId: normalizedSessionId,
      turnScopeId: normalizedTurnScopeId,
      metadata: resolutionMetadata,
    });
  }

  installSessionLifecycleHydration({
    sessions,
    activeSessionId,
    chatStore,
    scheduleTerminalResolution,
  });

  const { composerActionState, activeSessionSending, activeSessionCanStop } =
    createComposerRuntimeState({
      turnRuntimeRegistry,
      resolveActiveSessionIdentity,
      resolveActiveTurnScopeIdentity,
    });

  const submitTurnRuntimeEvent = createRuntimeEventProjector({
    sessions,
    activeSession,
    turnRuntimeRegistry,
    chatStore,
    resolveActiveSessionIdentity,
  });

  function trackConversationState(stateEntry = {}) {
    const state = String(stateEntry?.state || "").trim();
    if (!state) return;
    const sessionId = String(stateEntry?.sessionId || "").trim();
    const turnScopeId = String(stateEntry?.turnScopeId || "").trim();
    const dialogProcessId = String(stateEntry?.dialogProcessId || "").trim();
    const stateIdentity = turnScopeId
      ? `turnScope:${turnScopeId}`
      : dialogProcessId
        ? `dialogProcess:${dialogProcessId}`
        : "";
    const stateKey = `${sessionId || "__session__"}::${stateIdentity || "__session__"}`;
    const { createdAtMs, updatedAtMs, createdAt, updatedAt } = normalizeTimePair(stateEntry, {
      nowFallback: true,
    });
    const applied = stateEntry?.applied !== false;
    const normalizedEntry = {
      source: String(stateEntry?.source || "").trim(),
      sourceEvent: String(stateEntry?.sourceEvent || "").trim(),
      state,
      sessionId,
      turnScopeId,
      dialogProcessId,
      seq: Number(stateEntry?.seq || 0),
      applied,
      createdAtMs,
      updatedAtMs,
      createdAt,
      updatedAt,
    };
    conversationStateSnapshot.value = {
      ...conversationStateSnapshot.value,
      [stateKey]: normalizedEntry,
    };
    conversationStateTimeline.value = [
      ...conversationStateTimeline.value,
      {
        ...normalizedEntry,
        ts: updatedAt,
      },
    ].slice(-80);
    sessionLogWebSocketClient.log({
      category: "state",
      event: "conversation.state",
      sessionId,
      dialogProcessId,
      turnScopeId,
      data: normalizedEntry,
    });
    submitTurnRuntimeEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state,
      sessionId,
      dialogProcessId,
      turnScopeId,
      source: normalizedEntry.source || "conversation_state",
      sourceEvent: normalizedEntry.sourceEvent,
      seq: normalizedEntry.seq,
      createdAtMs,
      updatedAtMs,
      createdAt,
      updatedAt,
    });

    if (state.toLowerCase() === "user_stopped" && sessionId && turnScopeId) {
      const currentSessionId = resolveActiveSessionIdentity();
      const currentTurn = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        currentSessionId,
        resolveActiveTurnScopeIdentity(),
      );
      const identityMatches =
        sessionId === currentSessionId &&
        Boolean(currentTurn) &&
        ((turnScopeId && currentTurn.turnScopeId === turnScopeId) ||
          (!turnScopeId && dialogProcessId && currentTurn.dialogProcessId === dialogProcessId));
      const reconciliationKey = `${sessionId}::${turnScopeId}`;
      if (
        identityMatches &&
        !currentTurn.terminal &&
        !pendingStoppedSummaryReconciliations.has(reconciliationKey)
      ) {
        pendingStoppedSummaryReconciliations.set(
          reconciliationKey,
          Promise.resolve({
            applied: false,
            reason: "terminal_resolution_delegated",
          }),
        );
      }
    }
  }

  function hydrateStoppedRunStateFromSessionDetail({
    detail = {},
    sessionItem = null,
    mainSessionDoc = {},
  } = {}) {
    const sessionId = String(sessionItem?.sessionId || "").trim();
    const isCurrentSession = Boolean(sessionId && sessionId === resolveActiveSessionIdentity());
    if (!isCurrentSession) return;
    hydrateSessionDetailExtensions(
      {
        detail,
        sessionItem,
        mainSessionDoc,
      },
      {
        applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
        turnRuntimeRegistry: turnRuntimeRegistry.value,
        isTurnRuntimeDeleted,
      },
    );
    const terminalTurn = null;
  }

  const { input, uploadFiles, appendUploads, clearUploads, removeUpload, serializeAttachments } =
    useChatInput({
      isImageMime,
      clearUploadSelection,
    });

  const sessionLogWebSocketClient = createSessionLogWebSocketClient({
    resolveWebSocketUrl: () => buildLogWebSocketUrl({ apiKey: apiKey.value || "" }),
    resolveTransportOwner: () => String(userId.value || "").trim(),
    source: "frontend",
    refreshAuthentication,
  });
  const chatWebSocketClient = createChatWebSocketClient({
    resolveWebSocketUrl: () => buildChatWebSocketUrl({ apiKey: apiKey.value || "" }),
    resolveTransportOwner: () => String(userId.value || "").trim(),
    translateText: translate,
    refreshAuthentication,
    sessionLogSink: sessionLogWebSocketClient,
  });
  watch(apiKey, (nextApiKey, previousApiKey) => {
    if (nextApiKey && nextApiKey !== previousApiKey) sessionLogWebSocketClient.resume();
  });
  setStateMachineDebugLogSink(sessionLogWebSocketClient);
  setResendDebugLogSink(sessionLogWebSocketClient);
  setStopDebugLogSink(sessionLogWebSocketClient);
  setStopContinueDebugLogSink(sessionLogWebSocketClient);
  setReconnectTimingDebugLogSink(sessionLogWebSocketClient);
  setWorkflowDiagnosticsLogSink(sessionLogWebSocketClient);
  setThinkingReplayDebugLogSink(sessionLogWebSocketClient);
  setToolLogWindowDebugLogSink(sessionLogWebSocketClient);
  setTerminalResolutionDebugLogSink(sessionLogWebSocketClient);

  let lastComposerRenderSignature = "";
  watch(
    () => {
      const state = composerActionState.value || {};
      return [
        resolveActiveSessionIdentity(),
        resolveActiveTurnScopeIdentity(),
        state.displayState || "",
        activeSessionSending.value === true,
        state.canStop === true,
        state.primaryAction || "",
      ].join("|");
    },
    (signature) => {
      if (!signature || signature === lastComposerRenderSignature) return;
      lastComposerRenderSignature = signature;
      const state = composerActionState.value || {};
      const selectedSessionId = resolveActiveSessionIdentity();
      const selectedTurnScopeId = resolveActiveTurnScopeIdentity();
      const selectedTurn = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        selectedSessionId,
        selectedTurnScopeId,
      );
      logStateMachineDebug("stateMachine.composer.consumed", () => ({
        sessionId: selectedSessionId,
        turnScopeId: selectedTurnScopeId,
        runtime: summarizeStateMachineTurn(selectedTurn, state),
        displayState: state.displayState || "",
        sending: activeSessionSending.value === true,
        canStop: state.canStop === true,
        stopButtonVisible: state.canStop === true,
        stopRequesting: state.stopRequesting === true,
        primaryAction: state.primaryAction || "",
      }));
      sessionLogWebSocketClient.log({
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: "frontend.render.composerRuntimeConsumed",
        sessionId: selectedSessionId,
        turnScopeId: selectedTurnScopeId,
        data: {
          event: "frontend.render.composerRuntimeConsumed",
          selectedSessionId: resolveActiveSessionIdentity(),
          selectedTurnScopeId: resolveActiveTurnScopeIdentity(),
          displayState: state.displayState || "",
          sending: activeSessionSending.value === true,
          canStop: state.canStop === true,
          stopButtonVisible: state.canStop === true,
          stopRequesting: state.stopRequesting === true,
          primaryAction: state.primaryAction || "",
        },
      });
    },
    { immediate: true },
  );

  function logSessionSystemEvent(event, payload = {}) {
    sessionLogWebSocketClient.log({
      category: "system",
      event,
      sessionId:
        payload?.sessionId || String(activeSession.value?.sessionId || activeSessionId.value || ""),
      dialogProcessId: payload?.dialogProcessId || "",
      turnScopeId: payload?.turnScopeId || "",
      data: {
        event,
        at: new Date().toISOString(),
        ...payload,
      },
    });
  }

  const {
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
    markInteractionRequestHandled,
    isInteractionRequestHandled,
  } = useAgentInteraction({
    encryptPayloadBySessionId,
    sendJson: (payload) => chatWebSocketClient.sendJson(payload),
  });

  const connectorPanel = useConnectorPanel({
    ensureConnected,
    listUserConnectorsApi: listUserConnectors,
    getSessionConnectorsApi,
    putSessionConnectorSelectionApi,
    userId,
    authFetch,
    sessions,
    activeSession,
  });

  const {
    appendMessage,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    upsertCanonicalAssistantMessage,
    makeViewMessage,
    foldMessagesForView,
    shouldRenderMessageInChat,
  } = createSessionMessageView({ sessions, activeSession, activeSessionId, userId, isImageMime });

  const chatList = useChatList({
    userId,
    connected,
    ensureConnected,
    authFetch,
    sessions,
    activeSessionId,
    loadingSessions,
    loadingSessionDetail,
    turnRuntimeRegistry,
    createConnectorPanelState,
    generateSessionId,
    sessionTitleFromMessages,
    getSessionsApi,
    getSessionDetailApi,
    getSessionThinkingDetailApi,
    deleteSessionApi,
    renameSessionApi,
    deleteSessionMessagesFromApi,
    makeViewMessage,
    navigateToLastMessage,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    clearUploads,
    notify,
    processStore,
    onSessionDetailApplied: hydrateStoppedRunStateFromSessionDetail,
  });

  const chatEngine = useChatEngine({
    userId,
    allowUserInteraction,
    safeConfirm,
    safeConfirmLevel,
    sanitizeOutput,
    streamOutput,
    botScenario,
    selectedModel,
    memoryModel,
    pluginModelConfig,
    frontendThresholdsEnabled,
    summaryPolicy,
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
    input,
    uploadFiles,
    clearUploads,
    serializeAttachments,
    appendMessage,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    upsertCanonicalAssistantMessage,
    makeViewMessage,
    foldMessagesForView,
    applySessionDetail: chatList.applySessionDetail,
    deleteSessionMessagesFromApi,
    replaceSessionTurnApi,
    authFetch,
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
    refreshSessionsAsync: chatList.fetchSessions,
    onConversationState: trackConversationState,
    chatWebSocketClient,
    sessionLogWebSocketClient,
    applyTurnRuntimeEvent: submitTurnRuntimeEvent,
    applyTurnLifecycleEnvelope: chatStore.applyTurnLifecycleEnvelope,
    commitTurnTerminalResolution: chatStore.applyTurnTerminalResolution,
    applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
    reduceSubSessionMessageEvent: chatStore.reduceSubSessionMessageEvent,
    removeWorkflowOwnersForReplacedTurns: chatStore.removeWorkflowOwnersForReplacedTurns,
    ensureConnected,
    notify,
  });
  resolveDiscoveredTerminalTurn = chatEngine.resolveTurnTerminalState;
  for (const discovery of pendingTerminalResolutionDiscoveries.values()) {
    void resolveDiscoveredTerminalTurn(
      discovery.sessionId,
      discovery.turnScopeId,
      discovery.metadata,
    );
  }
  pendingTerminalResolutionDiscoveries.clear();

  const reconnectReplay = useReconnectReplay({
    sessions,
    activeSession,
    activeSessionId,
    turnRuntimeRegistry,
    interactionSubmitting,
    chatList,
    chatWebSocketClient,
    appendMessage,
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    makeViewMessage,
    foldMessagesForView,
    sessionTitleFromMessages,
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    isInteractionRequestHandled,
    classifyRealtimeLog,
    navigateToLastMessage,
    translate,
    onConversationState: trackConversationState,
    sessionLogWebSocketClient,
    notify,
    processStore,
    dispatchAuthoritativeRunStateEvent: chatEngine.dispatchAuthoritativeRunStateEvent,
    applyTurnLifecycleEnvelope: chatEngine.applyTurnLifecycleEnvelope,
    applyExecutionSnapshot: (payload) => chatStore.applyExecutionSnapshot(payload),
    applyExecutionChildren: (payload) => chatStore.applyExecutionChildren(payload),
    applyExecutionTree: (payload) => chatStore.applyExecutionTree(payload),
    applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
    reduceSubSessionMessageEvent: chatStore.reduceSubSessionMessageEvent,
    applyTurnLifecycleSnapshot: (snapshot) => chatStore.applyTurnLifecycleSnapshot(snapshot),
  });

  const { sendWithComposerActionState, stopSendingWithComposerActionState } = createComposerActions(
    {
      composerActionState,
      turnRuntimeRegistry,
      resolveActiveSessionIdentity,
      resolveActiveTurnScopeIdentity,
      submitTurnRuntimeEvent,
      waitForSessionConnectorState: connectorPanel.waitForSessionConnectorState,
      send: chatEngine.send,
      stopSending: chatEngine.stopSending,
      notify,
      translate,
    },
  );

  const { handleReconnect } = createReconnectCoordinator({
    activeSession,
    activeSessionId,
    turnRuntimeRegistry,
    userId,
    chatWebSocketClient,
    reconnectReplay,
    chatList,
    resolveActiveSessionIdentity,
    resolveActiveTurnScopeIdentity,
    logSessionSystemEvent,
    notify,
    translate,
  });

  return {
    input,
    uploadFiles,
    sending: activeSessionSending,
    canStop: activeSessionCanStop,
    composerActionState,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    newSession: chatList.newSession,
    deleteSession: chatList.deleteSession,
    renameSession: chatList.renameSession,
    fetchSessions: chatList.fetchSessions,
    fetchThinkingDetail: chatList.fetchThinkingDetail,
    selectSession: chatList.selectSession,
    send: sendWithComposerActionState,
    stopSending: stopSendingWithComposerActionState,
    prepareMonotonicMessageAction: chatEngine.prepareMonotonicMessageAction,
    cascadeDeleteMessagesFrom: chatEngine.cascadeDeleteMessagesFrom,
    deleteMonotonicMessage: chatEngine.deleteMonotonicMessage,
    resendMonotonicMessage: chatEngine.resendMonotonicMessage,
    refreshSessionConnectors: connectorPanel.refreshSessionConnectors,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    updateSessionSelectedConnectors: connectorPanel.updateSessionSelectedConnectors,
    pendingInteractionRequest,
    interactionSubmitting,
    submitInteractionResponse,
    appendUploads,
    clearUploads,
    removeUpload,
    shouldRenderMessageInChat,
    closeMobileSidebarOnSelect,
    releaseAllPreviewUrls: chatList.releaseAllPreviewUrls,
    initSessionsAfterMount: chatList.initSessionsAfterMount,
    chatWebSocketClient,
    sessionLogWebSocketClient,
    handleReconnect,
    conversationStateSnapshot,
    conversationStateTimeline,
    turnRuntimeRegistry,
    workflowNodeStateRegistry,
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
  };
}
