/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { toIsoTime } from "../model/timeFields.js";
import { AGENT_CHANNEL_STATE, AGENT_CHANNEL_STATE_SCOPE } from "@noobot/agent-transport-protocol";
import {
  buildChatWebSocketUrl,
  buildLogWebSocketUrl,
  deleteSessionApi,
  deleteSessionMessagesFromApi,
  getSessionConnectorsApi,
  getSessionDetailApi,
  getSessionsApi,
  putSessionConnectorSelectionApi,
  replaceSessionTurnApi,
  renameSessionApi,
} from "../../../infrastructure/api/chat/chatApi.js";
import { encryptPayloadBySessionId } from "../../../shared/utils/sessionCrypto.js";
import { listUserConnectors } from "../../../infrastructure/api/connectors/connectorApi.js";
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
import { hydrateSessionDetailExtensions } from "../../../extensions/session-detail-hydrator.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";

import { SESSION_RUN_EVENT } from "../runtime/sessionRunStateMachine.js";
import {
  logStateMachineDebug,
  setStateMachineDebugLogSink,
  summarizeStateMachineTurn,
} from "../../debug/loggers/stateMachineLogger.js";
import { setResendDebugLogSink } from "../../debug/loggers/resendDebugLogger.js";
import { setStopDebugLogSink } from "../../debug/loggers/stopDebugLogger.js";
import { setReconnectTimingDebugLogSink } from "../../debug/loggers/reconnectTimingDebugLogger.js";
import { setWorkflowDiagnosticsLogSink } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  logThinkingReplayDebug,
  setThinkingReplayDebugLogSink,
} from "../../debug/loggers/thinkingReplayDebugLogger.js";
import { setToolLogWindowDebugLogSink } from "../../debug/loggers/toolLogWindowDebugLogger.js";
import { setTerminalResolutionDebugLogSink } from "../../debug/loggers/terminalResolutionDebugLogger.js";
import { setTransportDiagnosticsLogSink } from "../../debug/loggers/transportDiagnosticsLogger.js";
import { setStreamDeltaDebugLogSink } from "../../debug/loggers/streamDeltaDebugLogger.js";
import { setPluginRuntimeDiagnosticsLogSink } from "../../debug/loggers/pluginRuntimeDiagnosticsLogger.js";
import { setTurnRuntimeDiagnosticsLogSink } from "../../debug/loggers/turnRuntimeDiagnosticsLogger.js";
import { setMessageMutationDiagnosticsLogSink } from "../../debug/loggers/messageMutationDiagnosticsLogger.js";
import { setEventProcessingTimingLogSink } from "../../debug/loggers/eventProcessingTimingLogger.js";
import {
  resolveSessionTurnRuntime,
  resolveLatestContinuableStoppedTurn,
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
import { text } from "@noobot/shared/value";

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
  navigateToLastMessage,
  notify = () => {},
  clearUploadSelection = () => {},
}) {
  const { translate } = useLocale();
  const chatStore = useChatStore();
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
    const sessionId = text(activeSession.value?.sessionId || activeSessionId.value);
    return sessionId;
  }

  function resolveActiveTurnScopeIdentity() {
    const sessionId = resolveActiveSessionIdentity();
    const activeTurn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId);
    const continuableStoppedTurn = !activeTurn
      ? resolveLatestContinuableStoppedTurn(turnRuntimeRegistry.value, sessionId)
      : null;
    return text(activeTurn?.turnScopeId || continuableStoppedTurn?.turnScopeId);
  }

  function scheduleTerminalResolution(sessionId, turnScopeId, metadata = {}) {
    const normalizedSessionId = text(sessionId);
    const normalizedTurnScopeId = text(turnScopeId);
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
    turnRuntimeRegistry,
    chatStore,
    resolveActiveSessionIdentity,
  });

  function trackConversationState(channelState = {}) {
    const { scope, state, sessionId, sourceEvent, seq, createdAtMs, updatedAtMs } = channelState;
    const turnScopeId = text(channelState.turnScopeId);
    const dialogProcessId = text(channelState.dialogProcessId);
    const stateKey = `${sessionId}::${scope === AGENT_CHANNEL_STATE_SCOPE.TURN ? turnScopeId : scope}`;
    const createdAt = toIsoTime(createdAtMs);
    const updatedAt = toIsoTime(updatedAtMs);
    const normalizedEntry = {
      source: text(channelState.source),
      scope,
      sourceEvent,
      state,
      sessionId,
      turnScopeId,
      dialogProcessId,
      seq,
      applied: channelState.applied,
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
      { ...normalizedEntry, ts: updatedAt },
    ].slice(-80);
    sessionLogWebSocketClient.log({
      scope: "session",
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
      source: normalizedEntry.source,
      sourceEvent,
      seq,
      createdAtMs,
      updatedAtMs,
      createdAt,
      updatedAt,
    });

    if (state === AGENT_CHANNEL_STATE.USER_STOPPED && turnScopeId) {
      const currentSessionId = resolveActiveSessionIdentity();
      const currentTurn = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        currentSessionId,
        resolveActiveTurnScopeIdentity(),
      );
      const reconciliationKey = `${sessionId}::${turnScopeId}`;
      if (
        sessionId === currentSessionId &&
        currentTurn?.turnScopeId === turnScopeId &&
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
    const sessionId = text(sessionItem?.sessionId);
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
  }

  const { input, uploadFiles, appendUploads, clearUploads, removeUpload, serializeAttachments } =
    useChatInput({
      isImageMime,
      clearUploadSelection,
    });

  const sessionLogWebSocketClient = createSessionLogWebSocketClient({
    resolveWebSocketUrl: () => buildLogWebSocketUrl({ apiKey: apiKey.value || "" }),
    resolveTransportOwner: () => text(userId.value),
    source: "frontend",
    refreshAuthentication,
  });
  const chatWebSocketClient = createChatWebSocketClient({
    resolveWebSocketUrl: () => buildChatWebSocketUrl({ apiKey: apiKey.value || "" }),
    resolveTransportOwner: () => text(userId.value),
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
  setReconnectTimingDebugLogSink(sessionLogWebSocketClient);
  setWorkflowDiagnosticsLogSink(sessionLogWebSocketClient);
  setThinkingReplayDebugLogSink(sessionLogWebSocketClient);
  setToolLogWindowDebugLogSink(sessionLogWebSocketClient);
  setTerminalResolutionDebugLogSink(sessionLogWebSocketClient);
  setTransportDiagnosticsLogSink(sessionLogWebSocketClient);
  setStreamDeltaDebugLogSink(sessionLogWebSocketClient);
  setPluginRuntimeDiagnosticsLogSink(sessionLogWebSocketClient);
  setTurnRuntimeDiagnosticsLogSink(sessionLogWebSocketClient);
  setMessageMutationDiagnosticsLogSink(sessionLogWebSocketClient);
  setEventProcessingTimingLogSink(sessionLogWebSocketClient);

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
        scope: "session",
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
      scope: "session",
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
    deleteSessionApi,
    renameSessionApi,
    deleteSessionMessagesFromApi,
    makeViewMessage,
    navigateToLastMessage,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    clearUploads,
    notify,
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
    navigateToLastMessage,
    activeSession,
    activeSessionId,
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
    findCanonicalMessageById,
    findCanonicalMessagesById,
    materializeTurnPresentation,
    makeViewMessage,
    clearPendingInteraction,
    setPendingInteractionRequest,
    isInteractionRequestHandled,
    sessionLogWebSocketClient,
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
      input,
      turnRuntimeRegistry,
      resolveActiveSessionIdentity,
      resolveActiveTurnScopeIdentity,
      submitTurnRuntimeEvent,
      waitForSessionConnectorState: connectorPanel.waitForSessionConnectorState,
      send: chatEngine.send,
      requestJson: chatWebSocketClient.requestJson,
      stopSending: chatEngine.stopSending,
      notify,
      translate,
    },
  );

  const { handleReconnect } = createReconnectCoordinator({
    activeSession,
    turnRuntimeRegistry,
    chatWebSocketClient,
    reconnectReplay,
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
