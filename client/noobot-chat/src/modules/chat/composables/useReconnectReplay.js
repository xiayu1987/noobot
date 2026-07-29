/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findSessionByAnyId as findSessionByAnyIdInList,
} from "../model/sessionIdentity.js";
import {
  findLatestPendingAssistantAfterLastUser,
} from "../model/reconnectReplayModel.js";
import { RoleEnum } from "../model/chatConstants.js";
import { getMessageRole } from "../model/messageIdentity.js";
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
  resolveConnectorConnectedPayload,
  resolveConnectorStatusPayload,
} from "../runtime/interactionPayload.js";
import { mergeAttachments } from "../model/dialogProcessChain.js";
import { terminalResolutionMetadata } from "../runtime/terminalResolutionMetadata.js";
import {
  createReconnectInteractionEnvelopeCallbacks,
  tryAutoResolveReconnectInteraction,
} from "../runtime/reconnect/interactionHandlers.js";
import {
  applyReconnectChannelState,
  emitSyntheticReconnectErrorConversationState,
  scheduleMissingInteractionPayloadFailure as scheduleMissingInteractionPayloadFailureWithContext,
} from "../runtime/reconnect/channelStateReplay.js";
import { applyReconnectDataReplay } from "../runtime/reconnect/reconnectDataReplay.js";
import { applyReconnectEventReplay } from "../runtime/reconnect/reconnectEventReplay.js";
import { scheduleCacheExpiredSessionRefresh as scheduleCacheExpiredSessionRefreshWithContext } from "../runtime/reconnect/cacheExpiredRefresh.js";
import {
  _ensureArray,
  _isAssistantRole,
  _matchesDialogProcessId,
} from "../runtime/reconnect/utils.js";
import { createReconnectReplayContext } from "../runtime/reconnect/context.js";
import {
  ensureReconnectSessionActive as ensureReconnectSessionActiveWithContext,
  isCurrentActiveSession as isCurrentActiveSessionWithContext,
} from "../runtime/reconnect/sessionActivation.js";
import {
  applyReconnectMessagesToActiveSessionReplay,
  consumeReconnectReplayCacheForSession,
  markReconnectSequenceApplied as markReconnectSequenceAppliedInConsumer,
} from "../runtime/reconnect/replayCacheConsumer.js";
import {
  applyAssistantFailureState as applyAssistantFailureStateWithContext,
  applyFoldedMessagesForDialogProcess as applyFoldedMessagesForDialogProcessWithContext,
  applyFoldedMessagesToActiveSession as applyFoldedMessagesToActiveSessionWithContext,
  buildReconnectReplayEnvelopeCallbacks,
  findAssistantMessageByDialogProcessId as findAssistantMessageByDialogProcessIdWithContext,
  findAssistantMessageByTurnScopeId as findAssistantMessageByTurnScopeIdWithContext,
  hasAssistantMessageWithContent as hasAssistantMessageWithContentWithContext,
  mergeAssistantAttachments as mergeAssistantAttachmentsWithContext,
} from "../runtime/reconnect/messageReplay.js";
import { createReconnectReplayPublicApi } from "../runtime/reconnect/publicApi.js";
import { registerReconnectReplayLifecycleCleanup } from "../runtime/reconnect/lifecycle.js";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "../runtime/sessionRunStateMachine.js";
import { isTurnRuntimeDeleted } from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { finalizeDoneTurnPresentation } from "../runtime/engine/sessionFinalize.js";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import { renderActiveSessionBeforeReplay } from "../runtime/reconnect/hydrationReplay.js";

export function useReconnectReplay({
  sessions,
  activeSession,
  activeSessionId,
  interactionSubmitting,
  chatList,
  chatWebSocketClient,
  appendMessage,
  findCanonicalMessageById,
  upsertCanonicalAssistantMessage,
  makeViewMessage,
  foldMessagesForView,
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
  applyWorkflowRuntimeEvent: reduceWorkflowRuntimeEvent,
} = {}) {
  const reconnectReplayContext = createReconnectReplayContext();
  const {
    replayCache,
    appliedReconnectSeqByDialogProcessId,
    appliedReconnectEventKindsByTurnKey,
    terminalDialogProcessIdSet,
    missingInteractionPayloadTimers,
  } =
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

  const applyWorkflowRuntimeEvent = (event, data = {}) => {
    sessionLogWebSocketClient?.log?.({
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.reconnectRuntimeReceived",
      sessionId: String(data?.parentSessionId || data?.sessionId || ""),
      dialogProcessId: String(data?.dialogProcessId || ""),
      turnScopeId: String(data?.turnScopeId || ""),
      data: {
        workflowEvent: String(event || ""),
        workflowRunId: String(data?.workflowRunId || ""),
        nodeExecutionId: String(data?.nodeExecutionId || ""),
        nodeSessionCount: Array.isArray(data?.nodeSessions) ? data.nodeSessions.length : 0,
      },
    });
    if (typeof reduceWorkflowRuntimeEvent === "function") {
      return reduceWorkflowRuntimeEvent({
        event,
        data,
        transportSequence: Number(data?.transportSequence || data?.seq || 0),
      }, { source: "reconnect" });
    }
    return { applied: false, reason: "workflow_runtime_projection_unavailable" };
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
  } = {}) {
    return scheduleMissingInteractionPayloadFailureWithContext({
      pendingInteractionRequest,
      missingInteractionPayloadTimers,
      sessionId,
      dialogProcessId,
      translate,
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

  async function applySubSessionReplayMessages(messages = [], context = {}) {
    let appliedCount = 0;
    let authoritativeEventCount = 0;
    for (const envelope of Array.isArray(messages) ? messages : []) {
      const packet = envelope?.data || {};
      const messageEvent = packet?.event && typeof packet.event === "object"
        ? packet.event
        : null;
      if (!messageEvent) continue;
      authoritativeEventCount += 1;
      const result = applyWorkflowRuntimeEvent("workflow_message_event", messageEvent);
      if (result?.applied === true) appliedCount += 1;
    }
    sessionLogWebSocketClient?.log?.({
      category: "debug",
      level: "debug",
      debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.subSessionReplayRouted",
      sessionId: String(context?.rootSessionId || ""),
      dialogProcessId: String(context?.dialogProcessId || ""),
      turnScopeId: String(context?.turnScopeId || ""),
      data: {
        replayEnvelopeCount: Array.isArray(messages) ? messages.length : 0,
        authoritativeEventCount,
        appliedCount,
        rootMessageProjectionSkipped: true,
      },
    });
    return { applied: appliedCount > 0, appliedCount };
  }

  async function applyReconnectData(reconnectData) {
    return applyReconnectDataReplay({
      reconnectData,
      ensureReconnectSessionActive,
      applyRunStateEvents,
      isCurrentActiveSession,
      replayCache,
      applyReconnectMessagesToActiveSession,
      applyChannelState,
      scheduleCacheExpiredSessionRefresh,
      reconcileSessionState,
      applySubSessionReplayMessages,
      isDeletedTurn,
      hydrateActiveSessionBeforeReplay,
    });
  }

  async function hydrateActiveSessionBeforeReplay(sessionId = "", currentRun = null) {
    const requestedSessionId = String(sessionId || "").trim();
    if (!requestedSessionId || !isCurrentActiveSession(requestedSessionId)) return false;
    const hydrated = await renderActiveSessionBeforeReplay({
      activeSession,
      activeSessionId,
      chatList,
      getReplayHydrationPromise: () => replayHydrationPromise,
      setReplayHydrationPromise: (promise) => {
        replayHydrationPromise = promise;
        reconnectReplayContext.replayHydrationPromise = promise;
      },
      onError: (error) => logReconnectReplaySystemEvent("reconnectReplay.hydration.failed", {
        sessionId: requestedSessionId,
        error: String(error?.message || error || ""),
      }),
    });
    if (!isCurrentActiveSession(requestedSessionId)) return false;
    const presentationMessageId = String(currentRun?.presentationMessageId || "").trim();
    if (!presentationMessageId) return hydrated;
    const existing = findCanonicalMessageById?.(requestedSessionId, presentationMessageId);
    if (!existing) {
      upsertCanonicalAssistantMessage?.(presentationMessageId, {
        sessionId: requestedSessionId,
        dialogProcessId: String(currentRun?.dialogProcessId || "").trim(),
        turnScopeId: String(currentRun?.turnScopeId || "").trim(),
      });
    }
    return Boolean(
      findCanonicalMessageById?.(requestedSessionId, presentationMessageId),
    );
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
      interactionSubmitting.value = false;
      clearPendingInteraction();
      return Promise.resolve({ applied: false, reason: "transient_interaction_cleared" });
    }
    if (terminalChannelStates.has(channelState)) {
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
      applySubSessionReplayMessages,
    });
  }

  function markReconnectSequenceApplied(dialogProcessId = "", sequence = 0, identity = {}) {
    markReconnectSequenceAppliedInConsumer(
      appliedReconnectSeqByDialogProcessId,
      dialogProcessId,
      sequence,
      {
        ...identity,
        appliedEventKindsByTurnKey: appliedReconnectEventKindsByTurnKey,
      },
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

  async function finalizeReconnectDoneSessionDetail(eventData = {}) {
    const sessionId = String(
      eventData?.sessionId || activeSession.value?.backendSessionId || activeSession.value?.id || "",
    ).trim();
    const turnScopeId = String(eventData?.turnScopeId || "").trim();
    const botMessage = turnScopeId
      ? findAssistantMessageByTurnScopeId(turnScopeId)
      : null;
    logWorkflowDiagnostics("frontend.workflowReplay.doneFinalDetailStarted", {
      sessionId,
      dialogProcessId: String(eventData?.dialogProcessId || "").trim(),
      turnScopeId,
      assistantFound: Boolean(botMessage),
      doneMessageCount: Array.isArray(eventData?.messages) ? eventData.messages.length : 0,
    });
    const applied = await finalizeDoneTurnPresentation({
      activeSession,
      activeSessionId,
      botMessage,
      finalDoneEventData: eventData,
      fetchSessionDetail: chatList.fetchSessionDetail,
      applySessionDetail: chatList.applySessionDetail,
      applyAssistantFailureState: (targetAssistantMessage, error) =>
        applyAssistantFailureStateWithContext({
          targetAssistantMessage,
          errorMessage: String(error?.message || error || ""),
          translate,
        }),
      applyRunStateEvent,
      refreshSessionConnectorsAsync,
      preserveCurrentMessages: true,
      logSessionEvent: (payload) => sessionLogWebSocketClient?.log?.(payload),
      completionSource: "reconnectDone",
    });
    logWorkflowDiagnostics("frontend.workflowReplay.doneFinalDetailFinished", {
      sessionId,
      dialogProcessId: String(eventData?.dialogProcessId || "").trim(),
      turnScopeId,
      applied: applied === true,
      activeMessageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    });
    return applied;
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
    { turnScopeId = "" } = {},
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
      findCanonicalMessageById,
      chatList,
      messages,
      dialogProcessId,
      turnScopeId,
      appliedReconnectSeqByDialogProcessId,
      appliedReconnectEventKindsByTurnKey,
      terminalDialogProcessIdSet,
      classifyRealtimeLog,
      envelopeCallbacks: createReconnectReplayEnvelopeCallbacks(),
      markReconnectSequenceApplied,
      navigateToLastMessage,
      processStore,
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
      applyWorkflowRuntimeEvent,
      applySubSessionReplayMessages,
      finalizeDoneTurnPresentation: finalizeReconnectDoneSessionDetail,
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
