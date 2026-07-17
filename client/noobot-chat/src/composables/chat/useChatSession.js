/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { applyCompletedToolLogsToMessages } from "../infra/sessionToolLogs";
import {
  buildAppendMessage,
  buildViewMessage,
  findVisibleLastMessage,
  foldConversationMessages,
  isHarnessInjectedMessage,
} from "../infra/messageModel";
import { normalizeTimePair, nowIso, nowMs } from "../infra/timeFields";
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
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";
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
import { useLocale } from "../../shared/i18n/useLocale";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../infra/messageIdentity";
import {
  applySessionRunStateEvent,
  BackendChannelState,
  BackendTerminalStates,
  clearRememberedStopRequests,
  evaluateSessionRunState,
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "./sessionRunStateMachine";
import { setStateMachineDebugLogSink } from "./debug/stateMachineLogger";
import { setResendDebugLogSink } from "./debug/resendDebugLogger";
import { setStopDebugLogSink } from "./debug/stopDebugLogger";
import { setStopContinueDebugLogSink } from "./debug/stopContinueDebugLogger";
import { setReconnectTimingDebugLogSink } from "./debug/reconnectTimingDebugLogger";
import {
  applyTurnRuntimeEvent,
  hydrateSessionTurnRuntime,
  resolveSessionTurnRuntime,
  turnRuntimeDisplayState,
} from "./sessionRunStateMachine/turnRuntimeRegistry";

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
    sending,
    canStop,
    runStateSnapshot,
    turnRuntimeRegistry,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
  } = storeToRefs(chatStore);
  const conversationStateSnapshot = ref({});
  const conversationStateTimeline = ref([]);
  const pendingStoppedSummaryReconciliations = new Map();
  function resolveActiveSessionIdentity() {
    return String(activeSession.value?.backendSessionId || activeSession.value?.sessionId || activeSession.value?.id || activeSessionId.value || "").trim();
  }

  function createTurnScopeId() {
    const randomUuid = globalThis?.crypto?.randomUUID?.();
    if (randomUuid) return `client-turn:${randomUuid}`;
    return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  }

  // Session documents may already be present when this composable is created
  // (initial bootstrap, tests, or a restored Pinia snapshot). Hydrate only from
  // authoritative turnStatuses; never infer runtime state from message order.
  for (const sessionItem of sessions.value) {
    hydrateSessionTurnRuntime(turnRuntimeRegistry.value, sessionItem);
  }

  // Reconcile replacements, refreshes, reconnects, and non-active sessions
  // from authoritative turnStatuses only; message order is never consulted.
  watch(
    sessions,
    (sessionItems) => {
      for (const sessionItem of Array.isArray(sessionItems) ? sessionItems : []) {
        hydrateSessionTurnRuntime(turnRuntimeRegistry.value, sessionItem);
      }
    },
    { deep: true },
  );

  const composerActionState = computed(() => {
    const sessionId = resolveActiveSessionIdentity();
    const turn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId);
    const displayState = turnRuntimeDisplayState(turn);
    const userStopped = turn?.terminal === "user_stopped";
    return {
      sendRequesting: displayState === "requesting",
      continueRequesting: false,
      stopRequesting: displayState === "stopping",
      stopPendingUntilBackendReady: false,
      canStartNewSend: true,
      canRetryMessage: true,
      canDeleteMessage: true,
      stopInFlight: displayState === "stopping",
      awaitingBackendStop: displayState === "stopping",
      userStopped,
      primaryAction: userStopped ? "continue" : "send",
      canContinue: userStopped,
      canResend: userStopped,
      state: displayState,
      displayState,
      canStop: displayState === "sending" && turn?.canStop === true,
    };
  });

  const applyComposerActionStateEvent = (event) => {
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, event, { fallbackSessionId: resolveActiveSessionIdentity() });
    return applySessionRunStateEvent({ stateRef: runStateSnapshot, sending, canStop, event });
  };

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
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      sending,
      canStop,
      event: {
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
      },
    });

    // The realtime event acknowledges that the backend persisted the stop; it
    // is not a second terminal source. Re-read the authoritative turnStatuses
    // for the exact active turn, including when this page was created by a
    // refresh and therefore has no original send() loop left to finalize it.
    if (state.toLowerCase() === "user_stopped" && sessionId && (turnScopeId || dialogProcessId)) {
      const currentSessionId = resolveActiveSessionIdentity();
      const currentTurn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, currentSessionId);
      const identityMatches = sessionId === currentSessionId && Boolean(currentTurn) && (
        (turnScopeId && currentTurn.turnScopeId === turnScopeId) ||
        (!turnScopeId && dialogProcessId && currentTurn.dialogProcessId === dialogProcessId)
      );
      const reconciliationKey = `${sessionId}::${turnScopeId || dialogProcessId}`;
      if (identityMatches && !currentTurn.terminal && !pendingStoppedSummaryReconciliations.has(reconciliationKey)) {
        const botMessage = (activeSession.value?.messages || []).find((messageItem) =>
          getMessageRole(messageItem) === RoleEnum.ASSISTANT && (
            (turnScopeId && getMessageTurnScopeId(messageItem) === turnScopeId) ||
            (!turnScopeId && getMessageDialogProcessId(messageItem) === dialogProcessId)
          ));
        const reconciliation = finalizeStoppedSessionDetail({
          activeSession,
          activeSessionId,
          botMessage,
          finalEventData: { ...stateEntry, sessionId, turnScopeId, dialogProcessId },
          fetchSessionDetail: chatList.fetchSessionDetail,
          applySessionDetail: chatList.applySessionDetail,
          applyRunStateEvent: applyComposerActionStateEvent,
        }).finally(() => pendingStoppedSummaryReconciliations.delete(reconciliationKey));
        pendingStoppedSummaryReconciliations.set(reconciliationKey, reconciliation);
      }
    }
  }

  function hydrateStoppedRunStateFromSessionDetail({ sessionItem = null } = {}) {
    if (sessionItem) hydrateSessionTurnRuntime(turnRuntimeRegistry.value, sessionItem);
    const sessionId = String(
      sessionItem?.backendSessionId || sessionItem?.sessionId || sessionItem?.id || "",
    ).trim();
    const terminalStatuses = new Set([
      "user_stopped", "completed", "error", "failed", "expired", "cancelled", "aborted",
    ]);
    const terminalTurn = (Array.isArray(sessionItem?.turnStatuses) ? sessionItem.turnStatuses : [])
      .filter((status) => terminalStatuses.has(String(status?.status || "").trim().toLowerCase()))
      .sort((left, right) => {
        const rightTime = Date.parse(right?.updatedAt || right?.createdAt || "") || Number(right?.revision || 0);
        const leftTime = Date.parse(left?.updatedAt || left?.createdAt || "") || Number(left?.revision || 0);
        return rightTime - leftTime;
      })[0] || null;
    const turnScopeId = String(terminalTurn?.turnScopeId || "").trim();
    const dialogProcessId = String(terminalTurn?.dialogProcessId || "").trim();
    const isCurrentSession = Boolean(sessionId && sessionId === resolveActiveSessionIdentity());

    // Session detail is authoritative after a reload. Clear every frontend stop
    // lease for this exact persisted turn; otherwise a remembered request or the
    // WebSocket confirmation timer can put the new page back into "stopping".
    if (isCurrentSession && terminalTurn && (turnScopeId || dialogProcessId)) {
      chatWebSocketClient.clearStopRequested();
      clearRememberedStopRequests({ sessionId, dialogProcessId, turnScopeId });
    }
    const terminalState = String(terminalTurn?.status || "").trim().toLowerCase();
    if (isCurrentSession && terminalState === "user_stopped" && turnScopeId) {
      applyComposerActionStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
        sessionId,
        dialogProcessId,
        turnScopeId,
        seq: Number(terminalTurn?.seq || terminalTurn?.revision || 0),
        timestamp: Date.parse(terminalTurn?.updatedAt || terminalTurn?.createdAt || "") || nowMs(),
        source: "session_detail_applied",
      });
      return;
    }
    // A successfully applied detail still releases temporary global interaction
    // locks when there is no scoped user-stopped terminal to project.
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      sending,
      canStop,
      event: {
        type: SESSION_RUN_EVENT.LOCAL_RESET,
        source: "session_detail_applied",
      },
    });
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
  });
  const sessionLogWebSocketClient = createSessionLogWebSocketClient({
    resolveWebSocketUrl: () => buildLogWebSocketUrl({ apiKey: apiKey.value || "" }),
    source: "frontend",
  });
  setStateMachineDebugLogSink(sessionLogWebSocketClient);
  setResendDebugLogSink(sessionLogWebSocketClient);
  setStopDebugLogSink(sessionLogWebSocketClient);
  setStopContinueDebugLogSink(sessionLogWebSocketClient);
  setReconnectTimingDebugLogSink(sessionLogWebSocketClient);

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

  function appendMessage(role, content = "", attachments = [], options = {}) {
    const msg = reactive(buildAppendMessage(role, content, attachments, options));
    activeSession.value.messages.push(msg);
    activeSession.value.messageCount = (activeSession.value.messageCount || 0) + 1;
    activeSession.value.lastMessage = findVisibleLastMessage(activeSession.value.messages);
    activeSession.value.updatedAt = nowIso();
    return msg;
  }

  function makeViewMessage(messageItem = {}) {
    return reactive(
      buildViewMessage(messageItem, {
        userId: userId.value,
        isImageMime,
      }),
    );
  }

  function foldMessagesForView(messages = []) {
    return foldConversationMessages(messages, makeViewMessage);
  }

  const chatList = useChatList({
    userId,
    connected,
    ensureConnected,
    authFetch,
    sessions,
    activeSessionId,
    loadingSessions,
    loadingSessionDetail,
    sending,
    canStop,
    runStateSnapshot,
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
    ensureConnected,
    notify,
    processStore,
  });

  const reconnectReplay = useReconnectReplay({
    sessions,
    activeSession,
    activeSessionId,
    sending,
    canStop,
    runStateSnapshot,
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
    applyTurnRuntimeEvents: (events = []) => {
      const sourceEvents = Array.isArray(events) ? events : [];
      // Session detail is the persisted source of truth for terminal turns. A
      // reconnect snapshot can race behind detail loading and still report the
      // old sending/stopping currentRun. Remove those stale facts from the
      // shared batch before it reaches either Registry or the global run state,
      // otherwise a refreshed stopped turn is resurrected as "stopping".
      for (let index = sourceEvents.length - 1; index >= 0; index -= 1) {
        const event = sourceEvents[index] || {};
        const eventSessionId = String(event.sessionId || resolveActiveSessionIdentity()).trim();
        const eventTurnScopeId = String(event.turnScopeId || "").trim();
        const eventDialogProcessId = String(event.dialogProcessId || "").trim();
        const sessionItem = sessions.value.find((item) => {
          const id = String(item?.backendSessionId || item?.sessionId || item?.id || "").trim();
          return id && id === eventSessionId;
        });
        const persistedTerminal = (Array.isArray(sessionItem?.turnStatuses) ? sessionItem.turnStatuses : [])
          .find((status) => {
            const sameTurn = eventTurnScopeId && String(status?.turnScopeId || "").trim() === eventTurnScopeId;
            const sameDialog = eventDialogProcessId && String(status?.dialogProcessId || "").trim() === eventDialogProcessId;
            return sameTurn || sameDialog;
          });
        const terminalStates = ["user_stopped", "completed", "error", "failed", "expired", "cancelled", "aborted"];
        const terminalState = String(persistedTerminal?.status || "").trim().toLowerCase();
        const incomingState = String(event.state || event.backendState || event.raw?.status || event.raw?.terminal || "")
          .trim()
          .toLowerCase();
        // Persisted terminal state only invalidates an older in-flight replay.
        // Never discard a matching real-time terminal event: it must still reach
        // turnRuntimeRegistry so the refreshed composer's stopping state settles
        // immediately instead of waiting for another detail reload.
        if (terminalStates.includes(terminalState) && !terminalStates.includes(incomingState)) {
          sourceEvents.splice(index, 1);
        }
      }
      for (const event of sourceEvents) {
        applyTurnRuntimeEvent(turnRuntimeRegistry.value, event, {
          fallbackSessionId: resolveActiveSessionIdentity(),
        });
      }
    },
  });

  async function sendWithComposerActionState(...args) {
    const sessionRuntimeIdValue = resolveActiveSessionIdentity();
    const currentTurn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionRuntimeIdValue);
    const stoppedTurn = currentTurn?.terminal === "user_stopped" ? currentTurn : null;
    const resumeDialogProcessId = String(stoppedTurn?.dialogProcessId || "").trim();
    const resumeTurnScopeId = String(stoppedTurn?.turnScopeId || "").trim();
    const resumeSessionId = resolveActiveSessionIdentity();
    const isContinueFromUserStopped = Boolean(stoppedTurn && resumeDialogProcessId && resumeTurnScopeId);
    if (currentTurn?.terminal === "user_stopped" && !isContinueFromUserStopped) {
      notify?.({
        type: "warning",
        message: translate("chat.sessionStateOutOfSync") || "Session state is out of sync. Refresh and try again.",
      });
      return false;
    }
    const composerEventType = isContinueFromUserStopped
      ? SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED
      : SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED;
    const composerSettledEventType = isContinueFromUserStopped
      ? SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_SETTLED
      : SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_SETTLED;
    const continuingTurnScopeId = isContinueFromUserStopped ? createTurnScopeId() : "";
    applyComposerActionStateEvent({
      type: composerEventType,
      sessionId: isContinueFromUserStopped ? resumeSessionId : undefined,
      turnScopeId: continuingTurnScopeId || undefined,
      source: "use_chat_session",
    });
    try {
      const [options = {}, ...restArgs] = args;
      const sendOptions = isContinueFromUserStopped
        ? {
            ...(options && typeof options === "object" ? options : {}),
            composerRequestStarted: true,
            continueFromUserStopped: true,
            turnScopeId: continuingTurnScopeId,
            resumeDialogProcessId,
            resumeTurnScopeId,
          }
        : {
            ...(options && typeof options === "object" ? options : {}),
            composerRequestStarted: true,
          };
      return await chatEngine.send(sendOptions, ...restArgs);
    } finally {
      applyComposerActionStateEvent({
        type: composerSettledEventType,
        source: "use_chat_session",
      });
    }
  }

  function stopSendingWithComposerActionState(...args) {
    if (!composerActionState.value.canStop) return false;
    // chatEngine.stopSending atomically records LOCAL_USER_STOP_REQUEST_STARTED
    // after it has resolved the active assistant identity. Dispatching it here
    // first would turn canStop off and make the engine reject its own request.
    const requested = chatEngine.stopSending(...args);
    return requested;
  }

  async function handleReconnect() {
    const pendingReconnectReplays = [];
    const trackReconnectReplay = (replayPromise) => {
      pendingReconnectReplays.push(Promise.resolve(replayPromise));
    };
    return chatWebSocketClient.reconnect({
      currentSessionId: String(activeSession.value?.backendSessionId || activeSessionId.value || ""),
      userId: String(userId?.value || userId || ""),
      onReconnectData: (reconnectPayload) => {
        if (reconnectPayload?.sessions) {
          trackReconnectReplay(reconnectReplay.applyReconnectData(reconnectPayload));
        }
        if (reconnectPayload?.event && reconnectPayload?.data) {
          trackReconnectReplay(
            reconnectReplay.applyReconnectEvent(reconnectPayload.event, reconnectPayload.data),
          );
        }
      },
    }).then(() => Promise.all(pendingReconnectReplays)).catch((error) => {
      logSessionSystemEvent("reconnect.failed", {
        error: String(error?.message || error || ""),
      });
      notify({ type: "warning", message: translate("infra.reconnectFailed") });
    });
  }

  function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
    if (isMobileRef.value) mobileSidebarOpenRef.value = false;
  }

  function shouldRenderMessageInChat(messageItem) {
    const messageRole = getMessageRole(messageItem);
    return messageRole !== RoleEnum.TOOL && !isHarnessInjectedMessage(messageItem);
  }

  return {
    input,
    uploadFiles,
    sending,
    canStop,
    composerActionState,
    sessions,
    activeSessionId,
    activeSession,
    runStateSnapshot,
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
    handleReconnect,
    conversationStateSnapshot,
    conversationStateTimeline,
  };
}
