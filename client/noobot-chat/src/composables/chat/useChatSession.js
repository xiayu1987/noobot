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
import { shouldProjectMainSessionEvent } from "./chatEngine/sendFlow";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "./chatEngine/turnProjectionStore";
import { finalizeStoppedSessionDetail } from "./chatEngine/sessionFinalize";
import { applyRunStateMessageRuntimePatch } from "./chatEngine/messageRuntimePatch";
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
import { setWorkflowDiagnosticsLogSink } from "./debug/workflowDiagnosticsLogger";
import {
  logThinkingReplayDebug,
  setThinkingReplayDebugLogSink,
} from "./debug/thinkingReplayDebugLogger";
import { setTerminalResolutionDebugLogSink } from "./debug/terminalResolutionDebugLogger";
import { findCanonicalTurnTiming } from "./sessionRunStateMachine/turnTiming";
import {
  isTurnRuntimeDeleted,
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
  sessionRuntimeId,
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

  function createTurnScopeId() {
    const randomUuid = globalThis?.crypto?.randomUUID?.();
    if (randomUuid) return `client-turn:${randomUuid}`;
    return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  }

  function hydrateSessionLifecycle(sessionItem) {
    const snapshot = sessionItem?.turnLifecycleSnapshot;
    const sessionId = sessionRuntimeId(sessionItem);
    const timingResult = chatStore.applyTurnTimingSnapshot({
      sessionId,
      turnTimings: Array.isArray(sessionItem?.turnTimings) ? sessionItem.turnTimings : [],
    });
    logThinkingReplayDebug("frontend.lifecycle.hydrateStarted", {
      requestedSessionId: String(sessionItem?.sessionId || "").trim(),
      runtimeSessionId: sessionId,
      snapshotSessionId: String(snapshot?.sessionId || "").trim(),
      snapshotSequence: Number(snapshot?.sequence || 0),
      activeTurnScopeId: String(snapshot?.activeTurnScopeId || "").trim(),
      recentTerminalCount: Array.isArray(snapshot?.recentTerminalTurns) ? snapshot.recentTerminalTurns.length : 0,
      turnTimingsCount: Array.isArray(sessionItem?.turnTimings) ? sessionItem.turnTimings.length : 0,
      timingSnapshotApplied: timingResult?.applied === true,
      timingSnapshotReason: timingResult?.reason || "",
    });
    if (snapshot && typeof snapshot === "object") {
      // A snapshot is only discovery metadata for terminal Turns. Schedule the
      // authoritative read independently of whether its non-terminal runtime
      // projection is applicable (older snapshots may intentionally lack the
      // complete terminal commit required by the current protocol).
      const candidates = [snapshot.activeTurn, ...(Array.isArray(snapshot.recentTerminalTurns) ? snapshot.recentTerminalTurns : [])]
        .filter((turn) => {
          // Refresh has no guarantee that the snapshot was captured after the
          // backend committed the terminal state.  The active Turn is therefore
          // also a discovery trigger; the terminal service decides whether it
          // is already resolved and supplies retry guidance otherwise.
          if (!turn || !getMessageTurnScopeId(turn) && !turn?.turnScopeId) return false;
          return turn === snapshot.activeTurn || isAuthoritativeTerminalState(turn?.state);
        })
        .sort((left, right) => Number(right?.sequence || right?.revision || 0) - Number(left?.sequence || left?.revision || 0));
      // Terminal discovery must not depend on the selected Session view being
      // ready. During refresh the summary can arrive before activeSession has
      // resolved its backend identity; gating here would permanently lose the
      // only trigger for the authoritative terminal read.
      if (sessionId && candidates[0]) {
        const turn = candidates[0];
        scheduleTerminalResolution(sessionId, getMessageTurnScopeId(turn) || turn?.turnScopeId, {
          ...turn,
          source: turn === snapshot.activeTurn ? "snapshot_active_turn" : "snapshot_terminal_turn",
        });
      }
      const result = chatStore.applyTurnLifecycleSnapshot(snapshot);
      logThinkingReplayDebug("frontend.lifecycle.hydrateApplied", {
        requestedSessionId: String(sessionItem?.sessionId || "").trim(),
        runtimeSessionId: sessionId,
        snapshotSessionId: String(snapshot?.sessionId || "").trim(),
        candidateTurnScopeId: String(candidates[0]?.turnScopeId || "").trim(),
        candidateState: String(candidates[0]?.state || "").trim(),
        candidateStartedAt: candidates[0]?.startedAt || "",
        candidateFinishedAt: candidates[0]?.finishedAt || "",
        resultApplied: result?.applied === true,
        resultReason: result?.reason || "",
      });
      // Apply the snapshot before the second local observation. A terminal GET
      // can finish while the refresh reducer is still materializing the
      // Session bucket; the coordinator will reuse its cached response and
      // project it now that the canonical bucket is available.
      if (sessionId && candidates[0]) {
        const turn = candidates[0];
        const postHydrateMetadata = {
          ...turn,
          source: "snapshot_post_hydrate",
        };
        Promise.resolve().then(() => scheduleTerminalResolution(
          sessionId,
          getMessageTurnScopeId(turn) || turn?.turnScopeId,
          postHydrateMetadata,
        ));
      }
      return result;
    }
    // Some refresh/detail responses contain only persisted turnStatuses. These
    // rows are discovery metadata, never runtime facts: feed the newest terminal
    // identity into the same authoritative resolver used by snapshots/realtime.
    const terminalStatus = (Array.isArray(sessionItem?.turnStatuses) ? sessionItem.turnStatuses : [])
      .filter((turn) => isLegacyTerminalDiscoveryState(turn?.status || turn?.state))
      .sort((left, right) => {
        const versionDelta = Number(right?.sequence || right?.revision || 0)
          - Number(left?.sequence || left?.revision || 0);
        if (versionDelta) return versionDelta;
        return String(right?.updatedAt || right?.createdAt || "")
          .localeCompare(String(left?.updatedAt || left?.createdAt || ""));
      })[0];
    if (sessionId && terminalStatus) {
      scheduleTerminalResolution(
        sessionId,
        getMessageTurnScopeId(terminalStatus) || terminalStatus?.turnScopeId,
        { ...terminalStatus, source: "turn_status_discovery" },
      );
      return { applied: false, reason: "terminal_resolution_scheduled" };
    }
    return { applied: false, reason: "terminal_discovery_missing" };
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

  // Snapshot and persisted status rows are discovery inputs only. Both converge
  // on the same authoritative terminal service and neither writes runtime state.
  for (const sessionItem of sessions.value) {
    hydrateSessionLifecycle(sessionItem);
    chatStore.pruneTerminalTurns({
      sessionId: sessionRuntimeId(sessionItem),
      referencedTurnScopeIds: (sessionItem?.messages || []).map(getMessageTurnScopeId).filter(Boolean),
    });
  }

  // Reconcile replacements, refreshes, reconnects, and non-active sessions
  // from the lifecycle protocol; message order is never consulted.
  watch(
    [sessions, activeSessionId],
    ([sessionItems]) => {
      for (const sessionItem of Array.isArray(sessionItems) ? sessionItems : []) {
        hydrateSessionLifecycle(sessionItem);
        chatStore.pruneTerminalTurns({
          sessionId: sessionRuntimeId(sessionItem),
          referencedTurnScopeIds: (sessionItem?.messages || []).map(getMessageTurnScopeId).filter(Boolean),
        });
      }
    },
    { deep: true },
  );

  const composerActionState = computed(() => {
    const sessionId = resolveActiveSessionIdentity();
    const turnScopeId = resolveActiveTurnScopeIdentity();
    const turn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId, turnScopeId);
    const runtimeView = selectSessionTurnRuntime(turnRuntimeRegistry.value, sessionId, turnScopeId);
    const displayState = runtimeView.displayState;
    const userStopped = turn?.terminal === "user_stopped";
    const actionLocked = runtimeView.sending === true;
    const stopRequesting = displayState === "requesting" && turn?.action === "stop";
    const awaitingStopSummary = displayState === "stopping";
    return {
      sendRequesting: displayState === "requesting" && turn?.action !== "stop",
      continueRequesting: false,
      stopRequesting,
      stopPendingUntilBackendReady: false,
      canStartNewSend: !actionLocked,
      canRetryMessage: !actionLocked,
      canDeleteMessage: !actionLocked,
      stopInFlight: stopRequesting || awaitingStopSummary,
      awaitingBackendStop: awaitingStopSummary,
      userStopped,
      primaryAction: userStopped ? "continue" : "send",
      canContinue: userStopped,
      canResend: userStopped,
      state: displayState,
      displayState,
      canStop: runtimeView.canStop,
    };
  });

  // UI runtime state always follows the selected session's registry projection.
  const activeSessionSending = computed(() =>
    selectSessionTurnRuntime(
      turnRuntimeRegistry.value,
      resolveActiveSessionIdentity(),
      resolveActiveTurnScopeIdentity(),
    ).sending,
  );
  const activeSessionCanStop = computed(() => composerActionState.value.canStop === true);

  // Composition-root boundary for runtime events. Every producer (composer,
  // stream, reconnect and finalization) submits here so a Registry transition
  // is projected to messages exactly once.
  const submitTurnRuntimeEvent = (event) => {
    const requestedSessionId = String(event?.sessionId || "").trim();
    const requestedTurnScopeId = String(event?.turnScopeId || "").trim();
    const owningSession = (Array.isArray(sessions.value) ? sessions.value : []).find(
      (item) => sessionRuntimeId(item) === requestedSessionId,
    );
    const canonicalTiming = findCanonicalTurnTiming(owningSession, requestedTurnScopeId);
    // Reconnect transport events do not carry lifecycle timing. Join the
    // persisted Session timing at the single Registry ingress so a restored
    // Turn never derives its clock from transport createdAtMs.
    const timedEvent = canonicalTiming
      ? {
        ...event,
        startedAt: canonicalTiming.thinkingStartedAt || event?.startedAt || "",
        finishedAt: canonicalTiming.thinkingFinishedAt || event?.finishedAt || "",
        thinkingStartedAt: canonicalTiming.thinkingStartedAt || event?.thinkingStartedAt || "",
        thinkingFinishedAt: canonicalTiming.thinkingFinishedAt || event?.thinkingFinishedAt || "",
        canonicalTimingObserved: true,
      }
      : event;
    const result = chatStore.applyTurnRuntimeEvent(timedEvent);
    const selectedSessionId = resolveActiveSessionIdentity();
    const activeBucket = turnRuntimeRegistry.value?.sessions?.[selectedSessionId] || null;
    logThinkingReplayDebug("frontend.lifecycle.runtimeConsumed", {
      sessionId: requestedSessionId || selectedSessionId,
      requestedSessionId,
      selectedSessionId,
      eventTurnScopeId: String(event?.turnScopeId || "").trim(),
      eventDialogProcessId: String(event?.dialogProcessId || "").trim(),
      eventType: String(event?.type || event?.eventType || "").trim(),
      eventState: String(event?.state || event?.backendState || "").trim(),
      resultApplied: result?.applied === true,
      resultReason: String(result?.reason || "").trim(),
      canonicalSessionId: String(result?.canonicalSessionId || result?.turn?.sessionId || "").trim(),
      canonicalTurnScopeId: String(result?.turn?.turnScopeId || "").trim(),
      canonicalState: String(result?.turn?.state || "").trim(),
      canonicalTerminal: result?.turn?.terminal || null,
      activeBucketTurnScopeId: String(activeBucket?.activeTurnScopeId || "").trim(),
    });
    // Runtime events have one projection contract regardless of whether they
    // arrive through the single-event composer/finalization path or reconnect's
    // batch path.  In particular, a backend event may atomically promote an
    // optimistic local Session; always project with the Registry's canonical
    // Turn rather than the pre-promotion input event.
    applyRunStateMessageRuntimePatch({
      sessions,
      activeSession,
      turnRuntimeRegistry,
      event: result?.turn || event,
    });
    return {
      ...result,
      messageEffect: {
        projected: Boolean(result?.turn),
        state: result?.turn?.state || "",
        terminal: result?.turn?.terminal || "",
      },
    };
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

  function hydrateStoppedRunStateFromSessionDetail({ sessionItem = null } = {}) {
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
  setWorkflowDiagnosticsLogSink(sessionLogWebSocketClient);
  setThinkingReplayDebugLogSink(sessionLogWebSocketClient);
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
        debugType: "thinking-replay",
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
    applyTurnRuntimeEvents: (events = []) => {
      const sourceEvents = Array.isArray(events) ? events : [];
      for (const event of sourceEvents) {
        const eventName = String(event?.event || event?.type || "").trim();
        if (eventName === "workflow_planning_message_prepared") {
          chatStore.upsertWorkflowPlanningEvent?.(event?.data || event);
        }
        if (eventName === "workflow_node_state_committed") {
          chatStore.upsertWorkflowNodeStateEvent?.(event?.data || event);
        }
      }
      // Replay events always reach the runtime registry. Legacy turnStatuses are
      // history/discovery metadata and are not allowed to suppress lifecycle
      // observations; registry identity and revision/sequence guards own stale
      // event rejection.
      return sourceEvents.map((event) => submitTurnRuntimeEvent(event));
    },
  });

  async function sendWithComposerActionState(...args) {
    const sessionRuntimeIdValue = resolveActiveSessionIdentity();
    const currentTurn = resolveSessionTurnRuntime(
      turnRuntimeRegistry.value,
      sessionRuntimeIdValue,
      resolveActiveTurnScopeIdentity(),
    );
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
    submitTurnRuntimeEvent({
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
      submitTurnRuntimeEvent({
        type: composerSettledEventType,
        source: "use_chat_session",
      });
    }
  }

  function stopSendingWithComposerActionState(...args) {
    // An explicit Execution target owns its own authoritative capabilities.
    // The composer state only describes the currently opened root turn and
    // must not block stopping a child/workflow execution in another channel.
    const explicitExecutionId = String(args[0] || "").trim();
    if (!explicitExecutionId && !composerActionState.value.canStop) return false;
    // chatEngine.stopSending atomically records LOCAL_USER_STOP_REQUEST_STARTED
    // after it has resolved the active assistant identity. Dispatching it here
    // first would turn canStop off and make the engine reject its own request.
    const requested = chatEngine.stopSending(...args);
    return requested;
  }

  function projectReconnectedMainSessionEvent(event, data = {}) {
    if (!shouldProjectMainSessionEvent(event, data)) return false;
    const messageEvent = data.event || {};
    const dialogProcessId = String(
      messageEvent.dialogProcessId || data.dialogProcessId || "",
    ).trim();
    const turnScopeId = String(messageEvent.turnScopeId || data.turnScopeId || "").trim();
    const sessionId = String(messageEvent.sessionId || data.sessionId || resolveActiveSessionIdentity()).trim();
    if (isTurnRuntimeDeleted(turnRuntimeRegistry.value, { sessionId, turnScopeId })) {
      logThinkingReplayDebug("frontend.messageEvent.deletedTurnRejected", {
        sessionId,
        dialogProcessId,
        turnScopeId,
        eventType: String(messageEvent.eventType || ""),
      });
      return true;
    }
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    // A stopped turn and its continuation may deliberately share a
    // dialogProcessId while owning different turnScopeIds. The turn is the
    // authoritative message projection identity; using the dialog first can
    // project continuation events into the stopped assistant message.
    const reversedAssistantMessages = [...messages].reverse().filter(
      (message) => getMessageRole(message) === RoleEnum.ASSISTANT,
    );
    const botMessage = turnScopeId
      ? reversedAssistantMessages.find(
          (message) => getMessageTurnScopeId(message) === turnScopeId,
        )
      : dialogProcessId
        ? reversedAssistantMessages.find(
            (message) => message?.pending === true &&
              getMessageDialogProcessId(message) === dialogProcessId,
          )
        : null;
    if (!botMessage) {
      logThinkingReplayDebug("frontend.thinkingReplay.liveProjectionTargetMissing", {
        sessionId: resolveActiveSessionIdentity(),
        dialogProcessId,
        turnScopeId,
        eventType: String(messageEvent.eventType || ""),
      });
      return false;
    }
    const reduction = dispatchTurnEnvelope({
      targetMessage: botMessage,
      envelope: messageEvent,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    });
    logThinkingReplayDebug("frontend.messageEvent.reduced", {
      source: "reconnect_live",
      sessionId: messageEvent.sessionId || resolveActiveSessionIdentity(),
      dialogProcessId,
      turnScopeId,
      messageId: String(messageEvent.messageId || ""),
      eventId: String(messageEvent.eventId || ""),
      eventType: String(messageEvent.eventType || ""),
      sequence: messageEvent.sequence ?? null,
      result: reduction.result,
      errors: reduction.errors || [],
    });
    return true;
  }

  async function handleReconnect() {
    const pendingReconnectReplays = [];
    let reconnectReplayQueue = Promise.resolve();
    const directExecutionRestoreCommandIds = new Set();
    const trackReconnectReplay = (replayPromise) => {
      pendingReconnectReplays.push(Promise.resolve(replayPromise));
    };
    const reconnectSessionId = String(activeSession.value?.backendSessionId || activeSessionId.value || "");
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectStarted", {
      sessionId: reconnectSessionId,
      visibleMessageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    });
    return chatWebSocketClient.reconnect({
      currentSessionId: reconnectSessionId,
      userId: String(userId?.value || userId || ""),
      onReconnectData: (reconnectPayload) => {
        logThinkingReplayDebug("frontend.thinkingReplay.reconnectPayloadReceived", {
          sessionId: reconnectSessionId,
          protocolEvent: String(reconnectPayload?.event || "reconnect_data"),
          sessionCount: Array.isArray(reconnectPayload?.sessions) ? reconnectPayload.sessions.length : 0,
          dataSequence: reconnectPayload?.data?.sequence ?? reconnectPayload?.data?.seq ?? null,
          dialogProcessId: String(reconnectPayload?.data?.dialogProcessId || ""),
          turnScopeId: String(reconnectPayload?.data?.turnScopeId || ""),
          dataKeys: Object.keys(reconnectPayload?.data || {}).sort(),
        });
        const replayPayload = async () => {
          if (reconnectPayload?.sessions) {
            await reconnectReplay.applyReconnectData(reconnectPayload);
          }
          if (!(reconnectPayload?.event && reconnectPayload?.data)) return;
          // After reconnect_complete this socket remains the live transport.
          // Authoritative main-session events must update the restored message
          // just like events received by the original send stream.
          if (projectReconnectedMainSessionEvent(reconnectPayload.event, reconnectPayload.data)) {
            return;
          }
          if (directExecutionRestoreCommandIds.has(String(reconnectPayload.data?.commandId || "").trim())) {
            return;
          }
          await reconnectReplay.applyReconnectEvent(reconnectPayload.event, reconnectPayload.data);
        };
        // WebSocket callbacks are synchronous but replay/hydration is not. Keep
        // protocol arrival order across separate callback invocations so a
        // trailing channel_state cannot race the DONE snapshot that owns its
        // Session+Turn identity.
        reconnectReplayQueue = reconnectReplayQueue.then(replayPayload, replayPayload);
        trackReconnectReplay(reconnectReplayQueue);
      },
    }).then(async () => {
      await Promise.all(pendingReconnectReplays);
      const replayRuntime = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        reconnectSessionId,
        resolveActiveTurnScopeIdentity(),
      );
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectReplayCommitted", {
        sessionId: reconnectSessionId,
        dialogProcessId: String(replayRuntime?.dialogProcessId || ""),
        turnScopeId: String(replayRuntime?.turnScopeId || ""),
        state: String(replayRuntime?.state || ""),
        backendState: String(replayRuntime?.backendState || ""),
        terminal: replayRuntime?.terminal ?? null,
        pendingReplayCount: pendingReconnectReplays.length,
      });
      if (typeof chatWebSocketClient.requestJson !== "function") return;
      const sessionId = String(activeSession.value?.backendSessionId || activeSessionId.value || "").trim();
      const currentTurn = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        sessionId,
        resolveActiveTurnScopeIdentity(),
      );
      const executionId = String(
        turnRuntimeRegistry.value?.executionIdByTurnScopeId?.[
          `${sessionId}::${currentTurn?.turnScopeId || ""}`
        ] ||
        currentTurn?.executionId ||
        "",
      ).trim();
      if (!executionId) return;
      const execution = turnRuntimeRegistry.value?.executions?.[executionId] || {};
      const rootExecutionId = String(execution?.rootExecutionId || executionId).trim();
      const requestExecution = async (action, payload, expectedEvent) => {
        const commandId = `reconnect:${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        directExecutionRestoreCommandIds.add(commandId);
        try {
          const response = await chatWebSocketClient.requestJson({
            action,
            commandId,
            userId: String(userId?.value || userId || "").trim(),
            ...payload,
          }, { expectedEvents: [expectedEvent] });
          await reconnectReplay.applyReconnectEvent(response?.event, response?.data || {});
        } finally {
          directExecutionRestoreCommandIds.delete(commandId);
        }
      };
      try {
        await requestExecution("execution.tree.get", { rootExecutionId }, StreamEventEnum.EXECUTION_TREE);
        await requestExecution("execution.snapshot.get", { executionId }, StreamEventEnum.EXECUTION_SNAPSHOT);
        if (typeof chatList.fetchSessionFullDetail === "function") {
          await chatList.fetchSessionFullDetail(sessionId);
        }
      } catch (error) {
        logSessionSystemEvent("reconnect.execution_restore_failed", {
          executionId,
          rootExecutionId,
          error: String(error?.message || error || ""),
        });
      }
    }).catch((error) => {
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectFailed", {
        sessionId: reconnectSessionId,
        error: String(error?.message || error || ""),
      });
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
  };
}
