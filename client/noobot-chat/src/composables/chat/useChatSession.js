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
  evaluateSessionRunState,
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "./sessionRunStateMachine";
import { setStateMachineDebugLogSink } from "./debug/stateMachineLogger";
import { setResendDebugLogSink } from "./debug/resendDebugLogger";
import { setStopDebugLogSink } from "./debug/stopDebugLogger";
import {
  logContinueResumeIdentitySelection,
  setStopContinueDebugLogSink,
} from "./debug/stopContinueDebugLogger";

export function useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  forceTool,
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
    userStoppedResumeSnapshots,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
  } = storeToRefs(chatStore);
  const conversationStateSnapshot = ref({});
  const conversationStateTimeline = ref([]);
  function resolveActiveSessionIdentity() {
    return String(activeSession.value?.backendSessionId || activeSession.value?.sessionId || activeSession.value?.id || activeSessionId.value || "").trim();
  }

  function createTurnScopeId() {
    const randomUuid = globalThis?.crypto?.randomUUID?.();
    if (randomUuid) return `client-turn:${randomUuid}`;
    return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  }

  function resolveActiveSessionIdentityCandidates() {
    return [
      activeSession.value?.backendSessionId,
      activeSession.value?.sessionId,
      activeSession.value?.id,
      activeSessionId.value,
    ].map((id) => String(id || "").trim()).filter(Boolean)
      .filter((id, index, list) => list.indexOf(id) === index);
  }

  function isRunStateForActiveSession(stateSnapshot = {}) {
    const runSessionId = String(stateSnapshot?.sessionId || "").trim();
    const state = String(stateSnapshot?.state || "").trim();
    const backendState = String(stateSnapshot?.backendState || "").trim();
    if (!runSessionId) {
      return state !== FrontendRunState.USER_STOP_COMPLETED && backendState !== BackendChannelState.USER_STOPPED;
    }
    const activeId = resolveActiveSessionIdentity();
    return Boolean(activeId && runSessionId === activeId);
  }

  function getActiveStoppedResumeSnapshot() {
    const matched = getActiveStoppedResumeSnapshotWithKey();
    return matched?.snapshot || null;
  }

  function getActiveStoppedResumeSnapshotWithKey() {
    for (const sessionId of resolveActiveSessionIdentityCandidates()) {
      const snapshot = chatStore.getUserStoppedResumeSnapshot(sessionId);
      if (snapshot) return { sessionId, snapshot };
    }
    return null;
  }

  // The registry snapshot is only a cache of the persisted stopped identity.
  // session.turnStatuses is the authoritative run history: cross-check the
  // cached resume identity against it so a stale cache (whose stopped turn was
  // deleted, pruned, or advanced to a terminal/error state) can never drive a
  // continue that the backend must reject with 409. When no turnStatuses have
  // been loaded we cannot contradict the registry and keep the cache as before.
  function isStoppedResumeIdentityBackedByTurnStatuses(dialogProcessId = "", turnScopeId = "") {
    const statuses = Array.isArray(activeSession.value?.turnStatuses)
      ? activeSession.value.turnStatuses
      : [];
    if (!statuses.length) return true;
    const dialog = String(dialogProcessId || "").trim();
    const scope = String(turnScopeId || "").trim();
    if (!dialog || !scope) return false;
    return statuses.some(
      (item) =>
        String(item?.dialogProcessId || "").trim() === dialog &&
        String(item?.turnScopeId || "").trim() === scope &&
        String(item?.status || "").trim().toLowerCase() === "user_stopped",
    );
  }

  function buildStoppedRunStateFromActiveRegistry() {
    const activeId = resolveActiveSessionIdentity();
    const snapshot = getActiveStoppedResumeSnapshot();
    if (!activeId || !snapshot?.dialogProcessId || !snapshot?.turnScopeId) return null;
    return {
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: activeId,
      dialogProcessId: snapshot.dialogProcessId,
      turnScopeId: snapshot.turnScopeId,
      seq: Number(snapshot.seq || 0),
      source: snapshot.source || "user_stopped_resume_registry",
      sourceEvent: "user_stopped_resume_registry",
      composerActionState: {},
    };
  }

  function resolveActiveSessionRunStateSnapshot() {
    if (isRunStateForActiveSession(runStateSnapshot.value)) return runStateSnapshot.value;
    return buildStoppedRunStateFromActiveRegistry() || {};
  }

  function evaluateActiveSessionRunState() {
    return evaluateSessionRunState(resolveActiveSessionRunStateSnapshot());
  }

  const composerActionState = computed(() => {
    const activeRunStateSnapshot = resolveActiveSessionRunStateSnapshot();
    const runStateInActiveSession = isRunStateForActiveSession(activeRunStateSnapshot);
    const evaluation = evaluateSessionRunState(activeRunStateSnapshot);
    const composerSnapshot = runStateInActiveSession ? activeRunStateSnapshot?.composerActionState || {} : {};
    return {
      sendRequesting: Boolean(composerSnapshot?.sendRequesting),
      continueRequesting: Boolean(composerSnapshot?.continueRequesting),
      stopRequesting: Boolean(composerSnapshot?.stopRequesting),
      stopPendingUntilBackendReady: Boolean(composerSnapshot?.stopPendingUntilBackendReady),
      canStartNewSend: evaluation.canStartNewSend !== false,
      canRetryMessage: evaluation.canRetryMessage !== false,
      canDeleteMessage: evaluation.canDeleteMessage !== false,
      stopInFlight: Boolean(evaluation.stopInFlight),
      awaitingBackendStop: Boolean(evaluation.awaitingBackendStop),
      userStopped: evaluation.state === FrontendRunState.USER_STOP_COMPLETED,
      state: evaluation.state || "",
    };
  });

  const applyComposerActionStateEvent = (event) => applySessionRunStateEvent({
    stateRef: runStateSnapshot,
    sending,
    canStop,
    event,
  });

  function replayPendingStopWhenBackendReady() {
    if (!isRunStateForActiveSession(runStateSnapshot.value)) return false;
    const evaluation = evaluateSessionRunState(runStateSnapshot.value);
    if (!evaluation.composerActionState?.stopPendingUntilBackendReady) return false;
    if (!evaluation.backendCanStop) return false;
    const requested = chatEngine.stopSending();
    if (requested) {
      applyComposerActionStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_CLEARED,
        source: "use_chat_session",
      });
    }
    return requested;
  }

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
    const stoppedResumeBeforeTransition = sessionId
      ? chatStore.getUserStoppedResumeSnapshot(sessionId)
      : null;
    const transitionResult = applySessionRunStateEvent({
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
    const nextRunState = transitionResult?.nextState || {};
    if (
      state === BackendChannelState.USER_STOPPED &&
      sessionId &&
      dialogProcessId &&
      turnScopeId &&
      nextRunState.state === FrontendRunState.USER_STOP_COMPLETED &&
      nextRunState.backendState === BackendChannelState.USER_STOPPED &&
      nextRunState.sessionId === sessionId &&
      nextRunState.dialogProcessId === dialogProcessId &&
      nextRunState.turnScopeId === turnScopeId
    ) {
      chatStore.rememberUserStoppedResumeSnapshot({
        sessionId,
        dialogProcessId,
        turnScopeId,
        seq: normalizedEntry.seq,
        source: normalizedEntry.sourceEvent || normalizedEntry.source || "conversation_state",
        updatedAt,
      });
    }
    const acceptedTerminalFactAdvancesStoppedSession = Boolean(
      stoppedResumeBeforeTransition &&
      transitionResult?.changed === true &&
      sessionId &&
      dialogProcessId &&
      turnScopeId &&
      nextRunState.sessionId === sessionId &&
      nextRunState.dialogProcessId === dialogProcessId &&
      nextRunState.turnScopeId === turnScopeId &&
      BackendTerminalStates.includes(nextRunState.backendState) &&
      nextRunState.backendState !== BackendChannelState.USER_STOPPED
    );
    if (acceptedTerminalFactAdvancesStoppedSession) {
      chatStore.clearUserStoppedResumeSnapshot(sessionId);
    }
  }

  function findLatestStoppedDetailIdentity(turnStatuses = []) {
    const statuses = Array.isArray(turnStatuses) ? turnStatuses : [];
    for (let index = statuses.length - 1; index >= 0; index -= 1) {
      const item = statuses[index];
      const status = String(item?.status || "").trim().toLowerCase();
      if (!status) continue;
      // turnStatuses is the persisted run history in chronological order. Only
      // its latest fact may restore the composer state; an older stopped turn
      // must not make a session resumable after a newer turn completed.
      if (status !== "user_stopped") return null;
      const dialogProcessId = String(item?.dialogProcessId || "").trim();
      const turnScopeId = String(item?.turnScopeId || "").trim();
      if (!dialogProcessId || !turnScopeId) return null;
      return { dialogProcessId, turnScopeId };
    }
    return null;
  }

  function canHydrateStoppedRunStateFromDetail(sessionId = "") {
    const evaluation = evaluateSessionRunState(runStateSnapshot.value);
    const state = evaluation.state;
    if (state === FrontendRunState.IDLE || state === FrontendRunState.USER_STOP_COMPLETED) return true;
    if (evaluation.awaitingBackendStop === true) return true;
    if (!sessionId) return false;
    return String(runStateSnapshot.value?.sessionId || "").trim() !== String(sessionId || "").trim();
  }

  function hydrateStoppedRunStateFromSessionDetail({ sessionItem = null } = {}) {
    const sessionId = String(sessionItem?.backendSessionId || sessionItem?.sessionId || sessionItem?.id || "").trim();
    if (!sessionId) return;
    const stoppedIdentity = findLatestStoppedDetailIdentity(sessionItem?.turnStatuses || []);
    if (!stoppedIdentity) {
      chatStore.clearUserStoppedResumeSnapshot(sessionId);
      return;
    }
    if (!canHydrateStoppedRunStateFromDetail(sessionId)) return;
    trackConversationState({
      source: "session_detail",
      sourceEvent: "session_detail_user_stopped",
      state: BackendChannelState.USER_STOPPED,
      sessionId,
      dialogProcessId: stoppedIdentity.dialogProcessId,
      turnScopeId: stoppedIdentity.turnScopeId,
      seq: 0,
      applied: true,
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
    forceTool,
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
  });

  watch(
    () => [
      runStateSnapshot.value?.state,
      runStateSnapshot.value?.sessionId,
      runStateSnapshot.value?.dialogProcessId,
      runStateSnapshot.value?.turnScopeId,
      runStateSnapshot.value?.composerActionState?.stopPendingUntilBackendReady,
    ],
    () => replayPendingStopWhenBackendReady(),
  );

  async function sendWithComposerActionState(...args) {
    const runStateEvaluation = evaluateActiveSessionRunState();
    if (runStateEvaluation.canStartNewSend === false) return false;
    if (composerActionState.value.sendRequesting || composerActionState.value.continueRequesting) return false;
    const stoppedResumeMatch = runStateEvaluation.state === FrontendRunState.USER_STOP_COMPLETED
      ? getActiveStoppedResumeSnapshotWithKey()
      : null;
    const activeRunState = resolveActiveSessionRunStateSnapshot();
    // A registry entry is only a cache of the persisted stopped identity.  It
    // must never turn a newer completed/current turn into a continuation.  In
    // particular, delayed detail/events can leave an older registry entry
    // behind after the session has already advanced to another turn.
    const isContinueFromUserStopped = Boolean(
      stoppedResumeMatch?.snapshot &&
      runStateEvaluation.state === FrontendRunState.USER_STOP_COMPLETED &&
      String(activeRunState?.backendState || "").trim() === BackendChannelState.USER_STOPPED &&
      String(activeRunState?.dialogProcessId || "").trim() === String(stoppedResumeMatch.snapshot.dialogProcessId || "").trim() &&
      String(activeRunState?.turnScopeId || "").trim() === String(stoppedResumeMatch.snapshot.turnScopeId || "").trim() &&
      isStoppedResumeIdentityBackedByTurnStatuses(
        stoppedResumeMatch.snapshot.dialogProcessId,
        stoppedResumeMatch.snapshot.turnScopeId,
      )
    );
    const resumeSessionId = String(
      stoppedResumeMatch?.sessionId || activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId.value || "",
    ).trim();
    const userStoppedResumeSnapshot = stoppedResumeMatch?.snapshot || null;
    if (runStateEvaluation.state === FrontendRunState.USER_STOP_COMPLETED && !isContinueFromUserStopped) {
      // The cached resume identity is contradicted by the authoritative
      // turnStatuses (its stopped turn was deleted/pruned/advanced to a terminal
      // state). Drop the stale cache so we stop firing continue requests that the
      // backend rejects with 409. A plain mismatch against a newer running turn
      // keeps the cache: that stopped turn may still be resumable later.
      if (
        stoppedResumeMatch?.sessionId &&
        !isStoppedResumeIdentityBackedByTurnStatuses(
          stoppedResumeMatch.snapshot?.dialogProcessId,
          stoppedResumeMatch.snapshot?.turnScopeId,
        )
      ) {
        chatStore.clearUserStoppedResumeSnapshot(stoppedResumeMatch.sessionId);
      }
      logContinueResumeIdentitySelection({
        runState: runStateSnapshot.value,
        selected: {
          continueFromUserStopped: true,
          resumeDialogProcessId: "",
          resumeTurnScopeId: "",
        },
        options: { resumeIdentitySource: "missing_user_stopped_resume_registry" },
      });
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
            continueFromUserStopped: true,
            turnScopeId: continuingTurnScopeId,
            resumeDialogProcessId: userStoppedResumeSnapshot?.dialogProcessId || "",
            resumeTurnScopeId: userStoppedResumeSnapshot?.turnScopeId || "",
            onContinueUserStoppedResumeSnapshotCommitted: () => {
              chatStore.consumeUserStoppedResumeSnapshot(resumeSessionId);
            },
          }
        : options;
      if (isContinueFromUserStopped) {
        logContinueResumeIdentitySelection({
          runState: runStateSnapshot.value,
          selected: sendOptions,
          options: {
            ...(options && typeof options === "object" ? options : {}),
            userStoppedResumeSnapshot,
          },
        });
      }
      return await chatEngine.send(sendOptions, ...restArgs);
    } finally {
      replayPendingStopWhenBackendReady();
      applyComposerActionStateEvent({
        type: composerSettledEventType,
        source: "use_chat_session",
      });
    }
  }

  function stopSendingWithComposerActionState(...args) {
    if (composerActionState.value.stopRequesting) return false;
    applyComposerActionStateEvent({
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      source: "use_chat_session",
    });
    const requested = chatEngine.stopSending(...args);
    if (!requested) {
      if (composerActionState.value.sendRequesting || composerActionState.value.continueRequesting) {
        applyComposerActionStateEvent({
          type: SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_BACKEND_READY,
          source: "use_chat_session",
        });
        return true;
      }
      applyComposerActionStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_SETTLED,
        source: "use_chat_session",
      });
    }
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
    userStoppedResumeSnapshots,
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
