/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { applyCompletedToolLogsToMessages } from "../infra/sessionToolLogs";
import { normalizeTimePair, nowMs } from "../infra/timeFields";
import {
  buildChatWebSocketUrl,
  buildLogWebSocketUrl,
  deleteSessionApi,
  deleteSessionMessagesFromApi,
  getSessionConnectorsApi,
  getSessionDetailApi,
  getSessionFullDetailApi,
  getSessionThinkingDetailApi,
  getSessionsApi,
  replaceSessionTurnApi,
  renameSessionApi,
} from "../../services/api/chatApi";
import { encryptPayloadBySessionId } from "../../shared/utils/sessionCrypto";
import { RoleEnum } from "../../shared/constants/chatConstants";
import {
  createConnectorPanelState,
  generateSessionId,
  sessionTitleFromMessages,
} from "../../shared/models/sessionModel";
import { createChatWebSocketClient } from "../../services/ws/chatWebSocketClient";
import { createSessionLogWebSocketClient } from "../../services/ws/sessionLogWebSocketClient";
import { useChatInput } from "./useChatInput";
import { useAgentInteraction } from "./useAgentInteraction";
import { useConnectorPanel } from "../infra/useConnectorPanel";
import { useChatList } from "./useChatList";
import { useChatEngine } from "./useChatEngine";
import { finalizeStoppedSessionDetail } from "./chatEngine/sessionFinalize";
import { useReconnectReplay } from "./useReconnectReplay";
import { useChatStore } from "../../shared/stores/useChatStore";
import { useProcessStore } from "../../shared/stores/useProcessStore";
import {
  hydrateWorkflowRegistryFromSessionDetail,
} from "./workflowSessionHydration";
import { useLocale } from "../../shared/i18n/useLocale";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../infra/messageIdentity";
import {
  BackendChannelState,
  clearRememberedStopRequests,
  evaluateSessionRunState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  isAuthoritativeTerminalState,
  isLegacyTerminalDiscoveryState,
} from "./sessionRunStateMachine";
import { setStateMachineDebugLogSink } from "./debug/stateMachineLogger";
import { setResendDebugLogSink } from "./debug/resendDebugLogger";
import { setStopDebugLogSink } from "./debug/stopDebugLogger";
import { setStopContinueDebugLogSink } from "./debug/stopContinueDebugLogger";
import { setReconnectTimingDebugLogSink } from "./debug/reconnectTimingDebugLogger";
import {
  setWorkflowDiagnosticsLogSink,
} from "./debug/workflowDiagnosticsLogger";
import {
  logThinkingReplayDebug,
  setThinkingReplayDebugLogSink,
} from "./debug/thinkingReplayDebugLogger";
import { setToolLogWindowDebugLogSink } from "./debug/toolLogWindowDebugLogger";
import { setTerminalResolutionDebugLogSink } from "./debug/terminalResolutionDebugLogger";
import {
  resolveSessionTurnRuntime,
  sessionRuntimeId,
} from "./sessionRunStateMachine/turnRuntimeRegistry";
import {
  closeMobileSidebarOnSelect,
  createSessionMessageView,
} from "./session/messageView";
import { createComposerRuntimeState } from "./session/composerRuntimeState";
import { createComposerActions } from "./session/composerActions";
import { createReconnectCoordinator } from "./session/reconnectCoordinator";
import { installSessionLifecycleHydration } from "./session/sessionLifecycleHydration";
import { createRuntimeEventProjector } from "./session/runtimeEventProjector";

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
  pluginModelConfig,
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
    // Registry, lifecycle snapshots and terminal resolution are keyed by the
    // backend Session identity. activeSessionId may intentionally remain the
    // optimistic/local UI key after refresh or during first-send promotion.
    const sessionId = String(
      activeSession.value?.backendSessionId
      || activeSession.value?.sessionId
      || activeSessionId.value
      || activeSession.value?.id
      || "",
    ).trim();
    return String(turnRuntimeRegistry.value?.sessionAliases?.[sessionId] || sessionId).trim();
  }

  function resolveActiveTurnScopeIdentity() {
    const sessionId = resolveActiveSessionIdentity();
    const canonicalSessionId = String(
      turnRuntimeRegistry.value?.sessionAliases?.[sessionId] || sessionId,
    ).trim();
    const activeScope = String(
      turnRuntimeRegistry.value?.sessions?.[canonicalSessionId]?.activeTurnScopeId || "",
    ).trim();
    if (activeScope) return activeScope;
    // Message order/status is a display projection, not Turn identity.  If the
    // canonical bucket has no active pointer there is no current runtime for the
    // Session-level action mutex.
    return "";
  }



  function scheduleTerminalResolution(sessionId, turnScopeId, metadata = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedSessionId || !normalizedTurnScopeId) return;
    const key = `${normalizedSessionId}::${normalizedTurnScopeId}`;
    const resolutionMetadata = { ...metadata };
    logThinkingReplayDebug("frontend.lifecycle.terminalDiscoveryScheduled", {
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
    });
    if (resolveDiscoveredTerminalTurn) {
      void resolveDiscoveredTerminalTurn(normalizedSessionId, normalizedTurnScopeId, resolutionMetadata);
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

  const {
    composerActionState,
    activeSessionSending,
    activeSessionCanStop,
  } = createComposerRuntimeState({
    turnRuntimeRegistry,
    resolveActiveSessionIdentity,
    resolveActiveTurnScopeIdentity,
  });

  // Composition-root boundary for runtime events. Every producer (composer,
  // stream, reconnect and finalization) submits here so a Registry transition
  // is projected to messages exactly once.
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
    const { createdAtMs, updatedAtMs, createdAt, updatedAt } = normalizeTimePair(stateEntry, { nowFallback: true });
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

    // The realtime event is only a trigger for terminal resolution. It must
    // never settle a Turn from the legacy turnStatuses projection.
    if (state.toLowerCase() === "user_stopped" && sessionId && (turnScopeId || dialogProcessId)) {
      const currentSessionId = resolveActiveSessionIdentity();
      const currentTurn = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        currentSessionId,
        resolveActiveTurnScopeIdentity(),
      );
      const identityMatches = sessionId === currentSessionId && Boolean(currentTurn) && (
        (turnScopeId && currentTurn.turnScopeId === turnScopeId) ||
        (!turnScopeId && dialogProcessId && currentTurn.dialogProcessId === dialogProcessId)
      );
      const reconciliationKey = `${sessionId}::${turnScopeId || dialogProcessId}`;
      if (identityMatches && !currentTurn.terminal && !pendingStoppedSummaryReconciliations.has(reconciliationKey)) {
        // The engine-level coordinator observes the same notification through
        // submitTurnRuntimeEvent. This session layer must not create a second
        // resolver or a second terminal fact source.
        pendingStoppedSummaryReconciliations.set(reconciliationKey, Promise.resolve({
          applied: false,
          reason: "terminal_resolution_delegated",
        }));
      }
    }
  }

  function hydrateStoppedRunStateFromSessionDetail({
    detail = {},
    sessionItem = null,
    mainSessionDoc = {},
  } = {}) {
    hydrateWorkflowRegistryFromSessionDetail({
      detail,
      sessionItem,
      mainSessionDoc,
      upsertWorkflowPlanningEvent: chatStore.upsertWorkflowPlanningEvent,
      upsertWorkflowNodeStateEvent: chatStore.upsertWorkflowNodeStateEvent,
      applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
      turnRuntimeRegistry: turnRuntimeRegistry.value,
    });
    const sessionId = String(
      sessionItem?.backendSessionId || sessionItem?.sessionId || sessionItem?.id || "",
    ).trim();
    // Legacy turnStatuses may be displayed as history, but cannot determine
    // lifecycle state. Terminal state is resolved through the single service.
    const terminalTurn = null;
    const isCurrentSession = Boolean(sessionId && sessionId === resolveActiveSessionIdentity());

    // Detail hydration is the deterministic boundary at which a cached
    // authoritative response may be projected locally. This never performs a
    // terminal GET and therefore cannot amplify replay/discovery traffic.
    // Session detail is authoritative after a reload. Clear every frontend stop
    // lease for this exact persisted turn; otherwise a remembered request or the
    // WebSocket confirmation timer can put the new page back into "stopping".
    // No matching terminal turn needs an additional runtime mutation. Hydration
    // above already reconciled this session without touching other sessions.
  }

  const {
    input,
    uploadFiles,
    appendUploads,
    clearUploads,
    removeUpload,
    serializeAttachments,
  } = useChatInput({
    isImageMime,
    clearUploadSelection,
  });

  const chatWebSocketClient = createChatWebSocketClient({
    resolveWebSocketUrl: () =>
      buildChatWebSocketUrl({ apiKey: apiKey.value || "" }),
    translateText: translate,
    refreshAuthentication,
  });
  const sessionLogWebSocketClient = createSessionLogWebSocketClient({
    resolveWebSocketUrl: () => buildLogWebSocketUrl({ apiKey: apiKey.value || "" }),
    source: "frontend",
    refreshAuthentication,
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
      sessionLogWebSocketClient.log({
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: "frontend.render.composerRuntimeConsumed",
        sessionId: resolveActiveSessionIdentity(),
        turnScopeId: resolveActiveTurnScopeIdentity(),
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
      sessionId: payload?.sessionId || String(activeSession.value?.backendSessionId || activeSessionId.value || ""),
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
    getSessionConnectorsApi,
    userId,
    authFetch,
    sessions,
    activeSession,
  });

  const {
    appendMessage,
    makeViewMessage,
    foldMessagesForView,
    shouldRenderMessageInChat,
  } = createSessionMessageView({ activeSession, activeSessionId, userId, isImageMime });

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
    applyCompletedToolLogsToMessages,
    getSessionsApi,
    getSessionDetailApi,
    getSessionFullDetailApi,
    getSessionThinkingDetailApi,
    deleteSessionApi,
    renameSessionApi,
    deleteSessionMessagesFromApi,
    makeViewMessage,
    foldMessagesForView,
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
    input,
    uploadFiles,
    clearUploads,
    serializeAttachments,
    appendMessage,
    makeViewMessage,
    foldMessagesForView,
    fetchSessionDetail: chatList.fetchSessionDetail,
    applySessionDetail: chatList.applySessionDetail,
    deleteSessionMessagesFromApi,
    replaceSessionTurnApi,
    authFetch,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    connectorTypeSet: connectorPanel.connectorTypeSet,
    upsertConnectedConnectorInPanelState:
      connectorPanel.upsertConnectedConnectorInPanelState,
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
    runtimeEventsAlreadyProjected: true,
    upsertWorkflowNodeStateEvent: chatStore.upsertWorkflowNodeStateEvent,
    upsertWorkflowPlanningEvent: chatStore.upsertWorkflowPlanningEvent,
    upsertSubSessionEvent: chatStore.upsertSubSessionEvent,
    applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
    ensureConnected,
    notify,
  });
  resolveDiscoveredTerminalTurn = chatEngine.resolveTurnTerminalState;
  for (const discovery of pendingTerminalResolutionDiscoveries.values()) {
    void resolveDiscoveredTerminalTurn(discovery.sessionId, discovery.turnScopeId, discovery.metadata);
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
    makeViewMessage,
    foldMessagesForView,
    applyCompletedToolLogsToMessages,
    sessionTitleFromMessages,
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    isInteractionRequestHandled,
    connectorTypeSet: connectorPanel.connectorTypeSet,
    upsertConnectedConnectorInPanelState:
      connectorPanel.upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    classifyRealtimeLog,
    navigateToLastMessage,
    translate,
    onConversationState: trackConversationState,
    sessionLogWebSocketClient,
    notify,
    processStore,
    resolveTurnTerminalState: chatEngine.resolveTurnTerminalState,
    applyExecutionSnapshot: (payload) => chatStore.applyExecutionSnapshot(payload),
    applyExecutionChildren: (payload) => chatStore.applyExecutionChildren(payload),
    applyExecutionTree: (payload) => chatStore.applyExecutionTree(payload),
    applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
    applyTurnRuntimeEvents: (events = []) => {
      const sourceEvents = Array.isArray(events) ? events : [];
      // Replay events always reach the runtime registry. Legacy turnStatuses are
      // history/discovery metadata and are not allowed to suppress lifecycle
      // observations; registry identity and revision/sequence guards own stale
      // event rejection.
      return sourceEvents.map((event) => submitTurnRuntimeEvent(event));
    },
  });

  const { sendWithComposerActionState, stopSendingWithComposerActionState } = createComposerActions({
    composerActionState,
    turnRuntimeRegistry,
    resolveActiveSessionIdentity,
    resolveActiveTurnScopeIdentity,
    submitTurnRuntimeEvent,
    send: chatEngine.send,
    stopSending: chatEngine.stopSending,
    notify,
    translate,
  });

  const { handleReconnect } = createReconnectCoordinator({
    activeSession,
    activeSessionId,
    turnRuntimeRegistry,
    userId,
    chatWebSocketClient,
    reconnectReplay,
    chatList,
    classifyRealtimeLog,
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
    fetchSessionFullDetail: chatList.fetchSessionFullDetail,
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
    updateSessionSelectedConnector: connectorPanel.updateSessionSelectedConnector,
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
  };
}
