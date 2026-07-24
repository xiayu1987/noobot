/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findSessionByAnyId as findSessionByAnyIdInList,
} from "../infra/sessionIdentity";
import {
  findLatestPendingAssistantAfterLastUser,
} from "../infra/reconnectReplayModel";
import { RoleEnum } from "../../shared/constants/chatConstants";
import { getMessageRole } from "../infra/messageIdentity";
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
  resolveConnectorConnectedPayload,
  resolveConnectorStatusPayload,
} from "./interactionPayload";
import { mergeAttachments } from "../infra/dialogProcessChain";
import { terminalResolutionMetadata } from "./terminalResolutionMetadata";
import {
  createReconnectInteractionEnvelopeCallbacks,
  tryAutoResolveReconnectInteraction,
} from "./reconnectReplay/interactionHandlers";
import {
  applyReconnectChannelState,
  emitSyntheticReconnectErrorConversationState,
  scheduleMissingInteractionPayloadFailure as scheduleMissingInteractionPayloadFailureWithContext,
} from "./reconnectReplay/channelStateReplay";
import { applyReconnectDataReplay } from "./reconnectReplay/reconnectDataReplay";
import { applyReconnectEventReplay } from "./reconnectReplay/reconnectEventReplay";
import { scheduleCacheExpiredSessionRefresh as scheduleCacheExpiredSessionRefreshWithContext } from "./reconnectReplay/cacheExpiredRefresh";
import {
  _ensureArray,
  _isAssistantRole,
  _matchesDialogProcessId,
} from "./reconnectReplay/utils";
import { createReconnectReplayContext } from "./reconnectReplay/context";
import {
  ensureReconnectSessionActive as ensureReconnectSessionActiveWithContext,
  isCurrentActiveSession as isCurrentActiveSessionWithContext,
} from "./reconnectReplay/sessionActivation";
import {
  applyReconnectMessagesToActiveSessionReplay,
  consumeReconnectReplayCacheForSession,
  markReconnectSequenceApplied as markReconnectSequenceAppliedInConsumer,
} from "./reconnectReplay/replayCacheConsumer";
import {
  applyAssistantFailureState as applyAssistantFailureStateWithContext,
  applyFoldedMessagesForDialogProcess as applyFoldedMessagesForDialogProcessWithContext,
  applyFoldedMessagesToActiveSession as applyFoldedMessagesToActiveSessionWithContext,
  buildReconnectReplayEnvelopeCallbacks,
  createFinalAssistantFromReconnectReplay as createFinalAssistantFromReconnectReplayWithContext,
  findAssistantMessageByDialogProcessId as findAssistantMessageByDialogProcessIdWithContext,
  findAssistantMessageByTurnScopeId as findAssistantMessageByTurnScopeIdWithContext,
  hasAssistantMessageWithContent as hasAssistantMessageWithContentWithContext,
  mergeAssistantAttachments as mergeAssistantAttachmentsWithContext,
  resolveReconnectTargetAssistantMessage as resolveReconnectTargetAssistantMessageWithContext,
} from "./reconnectReplay/messageReplay";
import {
  applyDoneMessagesFromReconnect as applyDoneMessagesFromReconnectWithContext,
} from "./reconnectReplay/doneReplay";
import { createReconnectReplayPublicApi } from "./reconnectReplay/publicApi";
import { registerReconnectReplayLifecycleCleanup } from "./reconnectReplay/lifecycle";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "./sessionRunStateMachine";
import { isTurnRuntimeDeleted } from "./sessionRunStateMachine/turnRuntimeRegistry";

export function useReconnectReplay({
  sessions,
  activeSession,
  activeSessionId,
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
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  classifyRealtimeLog,
  navigateToLastMessage,
  translate,
  onConversationState,
  sessionLogWebSocketClient,
  notify = () => {},
  processStore,
  turnRuntimeRegistry,
  applyTurnRuntimeEvents,
  resolveTurnTerminalState,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
} = {}) {
  const reconnectReplayContext = createReconnectReplayContext();
  const { replayCache, appliedReconnectSeqByDialogProcessId, terminalDialogProcessIdSet, missingInteractionPayloadTimers } =
    reconnectReplayContext;
  let { cacheExpiredRefreshTimer, replayHydrationPromise } = reconnectReplayContext;
  const protocolReconcileAttempts = new Map();
  const isDeletedTurn = ({ sessionId = "", turnScopeId = "" } = {}) =>
    isTurnRuntimeDeleted(turnRuntimeRegistry?.value || turnRuntimeRegistry, { sessionId, turnScopeId });

  const applyRunStateEvent = (event) => {
    const results = applyTurnRuntimeEvents?.([event]);
    return Array.isArray(results) ? results[0] : results;
  };
  const terminalLifecycleEvents = new Set([
    "turn.completed",
    "turn.stop_completed",
    "turn.failed",
  ]);
  const terminalChannelStates = new Set([
    "completed",
    "user_stopped",
    "error",
    "cancelled",
  ]);
  const requestTerminalResolution = (payload = {}) => {
    const sessionId = String(payload?.sessionId || "").trim();
    const turnScopeId = String(payload?.turnScopeId || payload?.messageEvent?.turnScopeId || "").trim();
    if (!sessionId || !turnScopeId) {
      return Promise.resolve({ applied: false, reason: "missing_turn_identity" });
    }
    if (typeof resolveTurnTerminalState !== "function") {
      return Promise.resolve({ applied: false, reason: "terminal_resolution_unavailable" });
    }
    return resolveTurnTerminalState(sessionId, turnScopeId, {
      ...terminalResolutionMetadata(payload),
      source: "reconnect_replay",
    });
  };
  const applyTurnLifecycleEnvelope = (envelope = {}) => {
    const eventType = String(envelope?.eventType || envelope?.event || "").trim().toLowerCase();
    if (terminalLifecycleEvents.has(eventType)) {
      // Replayed terminal envelopes are notifications, never terminal facts.
      return requestTerminalResolution(envelope);
    }
    return applyTurnRuntimeEvents?.([{
      ...envelope,
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      seq: Number(envelope?.sequence || 0),
      source: "turn_lifecycle_replay",
    }]);
  };

  const applyRunStateEvents = (events) => {
    const sourceEvents = Array.isArray(events) ? events : [];
    return applyTurnRuntimeEvents?.(sourceEvents);
  };

  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    return applyAssistantFailureStateWithContext({ targetAssistantMessage, errorMessage, translate });
  }

  function mergeAssistantAttachments(targetAssistantMessage, attachments = []) {
    return mergeAssistantAttachmentsWithContext({
      targetAssistantMessage,
      attachments,
      makeViewMessage,
      mergeAttachments,
    });
  }

  function tryAutoResolveInteraction(rawRequest = {}) {
    return tryAutoResolveReconnectInteraction({
      rawRequest,
      activeSession,
      interactionSubmitting,
      connectorTypeSet,
      normalizeInteractionRequestPayload,
      isAutoResolvedInteraction,
      resolveConnectorConnectedPayload,
      upsertConnectedConnectorInPanelState,
      refreshSessionConnectorsAsync,
      clearPendingInteraction,
    });
  }

  function createReconnectReplayEnvelopeCallbacks() {
    return createReconnectInteractionEnvelopeCallbacks({
      buildReconnectReplayEnvelopeCallbacks,
      missingInteractionPayloadTimers,
      normalizeInteractionRequestPayload,
      tryAutoResolveInteraction,
      isInteractionRequestHandled,
      setPendingInteractionRequest,
      activeSession,
      connectorTypeSet,
      resolveConnectorStatusPayload,
      upsertConnectedConnectorInPanelState,
      refreshSessionConnectorsAsync,
      onAttachments: mergeAssistantAttachments,
      onDoneMessages: applyDoneMessagesFromReconnect,
    });
  }

  function emitSyntheticErrorConversationState({
    sessionId = "",
    dialogProcessId = "",
    turnScopeId = "",
    sourceEvent = "",
  } = {}) {
    return emitSyntheticReconnectErrorConversationState({
      onConversationState,
      sessionId,
      dialogProcessId,
      turnScopeId,
      sourceEvent,
    });
  }

  function scheduleMissingInteractionPayloadFailure({
    sessionId = "",
    dialogProcessId = "",
    turnScopeId = "",
    targetAssistantMessage = null,
  } = {}) {
    return scheduleMissingInteractionPayloadFailureWithContext({
      pendingInteractionRequest,
      missingInteractionPayloadTimers,
      sessionId,
      dialogProcessId,
      turnScopeId,
      targetAssistantMessage,
      applyRunStateEvent,
      interactionSubmitting,
      clearPendingInteraction,
      translate,
      findFallbackAssistantMessage: () =>
        findLatestPendingAssistantAfterLastUser(activeSession.value?.messages || []),
      applyAssistantFailureState,
      emitSyntheticErrorConversationState,
      notify,
    });
  }

  function isCurrentActiveSession(sessionId = "") {
    return isCurrentActiveSessionWithContext({
      sessionId,
      activeSession: activeSession.value,
      activeSessionId: activeSessionId.value,
      sessions: sessions.value,
    });
  }

  async function ensureReconnectSessionActive(sessionId = "") {
    return ensureReconnectSessionActiveWithContext({
      sessionId,
      sessions,
      activeSession,
      activeSessionId,
      chatList,
    });
  }

  async function applyReconnectData(reconnectData) {
    return applyReconnectDataReplay({
      reconnectData,
      ensureReconnectSessionActive,
      applyRunStateEvents,
      isCurrentActiveSession,
      resolveReconnectTargetAssistantMessage,
      replayCache,
      applyReconnectMessagesToActiveSession,
      applyChannelState,
      scheduleCacheExpiredSessionRefresh,
      reconcileSessionState,
      isDeletedTurn,
    });
  }

  async function reconcileSessionState({
    sessionId = "",
    hasRunningTask = false,
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    let detailApplied = false;
    if (
      typeof chatList?.fetchSessionDetail === "function" &&
      typeof chatList?.applySessionDetail === "function"
    ) {
      const detail = await chatList.fetchSessionDetail(normalizedSessionId, {
        source: "reconnectProtocolReconcile",
      }).catch(() => null);
      if (detail) {
        chatList.applySessionDetail(detail, {
          preserveCurrentMessages: false,
          scrollToBottom: false,
        });
        detailApplied = true;
      }
    }
    if (!hasRunningTask) return detailApplied;

    const attempts = Number(protocolReconcileAttempts.get(normalizedSessionId) || 0);
    if (attempts >= 1 || typeof chatWebSocketClient?.reconnect !== "function") {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_FAILURE,
        state: BackendChannelState.ERROR,
        sessionId: normalizedSessionId,
        source: "reconnect_protocol_mismatch",
      });
      notify({ type: "warning", message: translate("infra.reconnectFailed") });
      return false;
    }

    protocolReconcileAttempts.set(normalizedSessionId, attempts + 1);
    setTimeout(() => protocolReconcileAttempts.delete(normalizedSessionId), 5000);
    await chatWebSocketClient.reconnect({
      currentSessionId: normalizedSessionId,
      onReconnectData: (payload) => {
        if (payload?.sessions) void applyReconnectData(payload);
        if (payload?.event && payload?.data) {
          void applyReconnectEvent(payload.event, payload.data);
        }
      },
    }).catch(() => null);
    return true;
  }

  function applyChannelState(stateData = {}) {
    const channelState = String(stateData?.state || stateData?.channelState || "").trim().toLowerCase();
    if (channelState === BackendChannelState.EXPIRED) {
      // Cache expiry is a transport/cache recovery signal, not an authoritative
      // Turn terminal fact. Preserve its refresh side effect without allowing it
      // to settle lifecycle or unlock capabilities.
      const turnScopeId = String(stateData?.turnScopeId || "").trim();
      scheduleCacheExpiredSessionRefresh({
        sessionId: String(stateData?.sessionId || "").trim(),
        dialogProcessId: String(stateData?.dialogProcessId || "").trim(),
        targetAssistantMessage: turnScopeId
          ? findAssistantMessageByTurnScopeId(turnScopeId)
          : null,
      });
      return Promise.resolve({ applied: false, reason: "cache_refresh_scheduled" });
    }
    if (channelState === BackendChannelState.NO_CONVERSATION) {
      // No-conversation only invalidates transient interaction transport state.
      // A business Turn terminal state still requires Terminal Resolution.
      interactionSubmitting.value = false;
      clearPendingInteraction();
      return Promise.resolve({ applied: false, reason: "transient_interaction_cleared" });
    }
    if (terminalChannelStates.has(channelState)) {
      // Terminal channel state is notification evidence only. In particular it
      // must not patch message terminal presentation, release the business lock,
      // fetch session detail, or dispatch a terminal runtime transition. The
      // authoritative terminal response owns all of those changes atomically.
      return requestTerminalResolution(stateData);
    }
    return applyReconnectChannelState({
      stateData,
      onConversationState,
      isCurrentActiveSession,
      findAssistantMessageByTurnScopeId,
      turnRuntimeRegistry,
      findAssistantMessageByDialogProcessId,
      findFallbackAssistantMessage: findReconnectChannelStateFallbackAssistant,
      applyRunStateEvent,
      interactionSubmitting,
      clearPendingInteractionIfObsolete,
      pendingInteractionRequest,
      normalizeInteractionRequestPayload,
      tryAutoResolveInteraction,
      isInteractionRequestHandled,
      setPendingInteractionRequest,
      scheduleMissingInteractionPayloadFailure,
      missingInteractionPayloadTimers,
      terminalDialogProcessIdSet,
      chatWebSocketClient,
      scheduleCacheExpiredSessionRefresh,
      clearPendingInteraction,
      translate,
    });
  }

  function resolveReconnectTargetAssistantMessage(
    dialogProcessId = "",
    { allowCreate = true, turnScopeId = "" } = {},
  ) {
    return resolveReconnectTargetAssistantMessageWithContext({
      activeSession,
      appendMessage,
      dialogProcessId,
      turnScopeId,
      allowCreate,
    });
  }

  function scheduleCacheExpiredSessionRefresh({
    sessionId = "",
    dialogProcessId = "",
    targetAssistantMessage = null,
  } = {}) {
    return scheduleCacheExpiredSessionRefreshWithContext({
      getCacheExpiredRefreshTimer: () => cacheExpiredRefreshTimer,
      setCacheExpiredRefreshTimer: (timer) => {
        cacheExpiredRefreshTimer = timer;
        reconnectReplayContext.cacheExpiredRefreshTimer = timer;
      },
      replayCache,
      interactionSubmitting,
      clearPendingInteraction,
      translate,
      activeSession,
      activeSessionId,
      chatList,
      applyRunStateEvent,
      applyAssistantFailureState,
      emitSyntheticErrorConversationState,
      notify,
      sessionId,
      dialogProcessId,
      targetAssistantMessage,
    });
  }

  async function consumeReplayCacheForSession(sessionId = "") {
    return consumeReconnectReplayCacheForSession({
      replayCache,
      sessionId,
      applyReconnectMessagesToActiveSession,
    });
  }

  function markReconnectSequenceApplied(dialogProcessId = "", sequence = 0, identity = {}) {
    markReconnectSequenceAppliedInConsumer(
      appliedReconnectSeqByDialogProcessId,
      dialogProcessId,
      sequence,
      identity,
    );
  }

  function findAssistantMessageByDialogProcessId(dialogProcessId = "") {
    return findAssistantMessageByDialogProcessIdWithContext(activeSession, dialogProcessId);
  }

  function findAssistantMessageByTurnScopeId(turnScopeId = "") {
    return findAssistantMessageByTurnScopeIdWithContext(activeSession, turnScopeId);
  }

  function hasAssistantMessageWithContent(content = "") {
    return hasAssistantMessageWithContentWithContext(activeSession, content);
  }

  function findReconnectChannelStateFallbackAssistant() {
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    return (
      findLatestPendingAssistantAfterLastUser(messages) ||
      [...messages]
        .reverse()
        .find((messageItem) => getMessageRole(messageItem) === RoleEnum.ASSISTANT) ||
      null
    );
  }

  function applyFoldedMessagesToActiveSession(foldedMessages = []) {
    return applyFoldedMessagesToActiveSessionWithContext(activeSession, foldedMessages);
  }

  function applyFoldedMessagesForDialogProcess(foldedMessages = [], dialogProcessId = "") {
    return applyFoldedMessagesForDialogProcessWithContext(
      activeSession,
      foldedMessages,
      dialogProcessId,
    );
  }

  function createFinalAssistantFromReconnectReplay(messages = [], dialogProcessId = "") {
    return createFinalAssistantFromReconnectReplayWithContext({
      activeSession,
      appendMessage,
      messages,
      dialogProcessId,
    });
  }

  function applyDoneMessagesFromReconnect(eventData = {}) {
    return applyDoneMessagesFromReconnectWithContext({
      activeSession,
      activeSessionId,
      eventData,
      makeViewMessage,
      foldMessagesForView,
      applyCompletedToolLogsToMessages,
      sessionTitleFromMessages,
      applyFoldedMessagesForDialogProcess: applyFoldedMessagesForDialogProcessWithContext,
      applyFoldedMessagesToActiveSession: applyFoldedMessagesToActiveSessionWithContext,
    });
  }

  function logReconnectReplaySystemEvent(event, payload = {}) {
    sessionLogWebSocketClient?.log?.({
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

  async function applyReconnectMessagesToActiveSession(
    messages,
    dialogProcessId,
    { allowCreate = true, turnScopeId = "", authoritativeCurrentRun = false } = {},
  ) {
    const sessionId = String(
      activeSession.value?.backendSessionId || activeSession.value?.sessionId || activeSessionId.value || "",
    ).trim();
    if (isDeletedTurn({ sessionId, turnScopeId })) {
      return { applied: false, reason: "deleted_turn_tombstoned" };
    }
    return applyReconnectMessagesToActiveSessionReplay({
      activeSession,
      activeSessionId,
      appendMessage,
      chatList,
      messages,
      dialogProcessId,
      turnScopeId,
      allowCreate,
      authoritativeCurrentRun,
      appliedReconnectSeqByDialogProcessId,
      terminalDialogProcessIdSet,
      classifyRealtimeLog,
      getReplayHydrationPromise: () => replayHydrationPromise,
      setReplayHydrationPromise: (promise) => {
        replayHydrationPromise = promise;
        reconnectReplayContext.replayHydrationPromise = promise;
      },
      applyDoneMessages: applyDoneMessagesFromReconnect,
      envelopeCallbacks: createReconnectReplayEnvelopeCallbacks(),
      markReconnectSequenceApplied,
      navigateToLastMessage,
      processStore,
      onHydrationError: (error) => logReconnectReplaySystemEvent("reconnectReplay.hydration.failed", {
        dialogProcessId,
        error: String(error?.message || error || ""),
      }),
    });
  }

  async function applyReconnectEvent(event, data) {
    return applyReconnectEventReplay({
      event,
      data,
      replayCache,
      isCurrentActiveSession,
      isCurrentActiveDialogProcess: (dialogProcessId) =>
        Boolean(findAssistantMessageByDialogProcessId(dialogProcessId)),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyChannelState,
      hasAuthoritativeCurrentRun: ({ sessionId = "", turnScopeId = "" } = {}) => {
        const requestedSessionId = String(sessionId || "").trim();
        const requestedTurnScopeId = String(turnScopeId || "").trim();
        if (!requestedSessionId || !requestedTurnScopeId) return false;
        const sessionEntry = (Array.isArray(sessions.value) ? sessions.value : []).find((entry) => {
          const entrySessionId = String(entry?.backendSessionId || entry?.sessionId || entry?.id || "").trim();
          return entrySessionId === requestedSessionId;
        });
        const currentRun = sessionEntry?.currentRun;
        return (
          String(currentRun?.sessionId || requestedSessionId).trim() === requestedSessionId &&
          String(currentRun?.turnScopeId || "").trim() === requestedTurnScopeId
        );
      },
      applyTurnLifecycleEnvelope,
      applyExecutionSnapshot,
      applyExecutionChildren,
      applyExecutionTree,
      isDeletedTurn,
    });
  }

  registerReconnectReplayLifecycleCleanup({
    missingInteractionPayloadTimers,
    getCacheExpiredRefreshTimer: () => cacheExpiredRefreshTimer,
    setCacheExpiredRefreshTimer: (timer) => {
      cacheExpiredRefreshTimer = timer;
      reconnectReplayContext.cacheExpiredRefreshTimer = timer;
    },
  });

  return createReconnectReplayPublicApi({
    applyReconnectData,
    applyReconnectEvent,
    applyChannelState,
    replayCache,
    appliedReconnectSeqByDialogProcessId,
    terminalDialogProcessIdSet,
    isTestMode: import.meta.env.MODE === "test",
  });
}
