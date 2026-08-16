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
import {
  createReconnectInteractionEnvelopeCallbacks,
  tryAutoResolveReconnectInteraction,
} from "../runtime/reconnect/interactionHandlers.js";
import { applyReconnectDataReplay } from "../runtime/reconnect/reconnectDataReplay.js";
import { applyReconnectEventReplay } from "../runtime/reconnect/reconnectEventReplay.js";
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
import {
  BackendChannelState,
} from "../runtime/sessionRunStateMachine.js";
import { isTurnRuntimeDeleted } from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../debug/loggers/stateMachineLogger.js";
import { renderActiveSessionBeforeReplay } from "../runtime/reconnect/hydrationReplay.js";
import { applyReconnectInteractionRequest } from "../runtime/reconnect/interactionReplay.js";
import { handleAttachmentLifecycleStreamEvent } from "../runtime/engine/streamHandlers.js";

export function useReconnectReplay({
  sessions,
  activeSession,
  activeSessionId,
  interactionSubmitting,
  chatList,
  chatWebSocketClient,
  appendMessage,
  findCanonicalMessageById,
  findCanonicalMessagesById,
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
  dispatchAuthoritativeRunStateEvent,
  applyTurnLifecycleEnvelope,
  applyExecutionSnapshot,
  applyExecutionChildren,
  applyExecutionTree,
  applyWorkflowRuntimeEvent: reduceWorkflowRuntimeEvent,
  applyTurnLifecycleSnapshot,
} = {}) {
  const reconnectReplayContext = createReconnectReplayContext();
  const {
    replayCache,
    appliedReconnectSequenceByTurnKey,
    appliedReconnectEventKindsByTurnKey,
  } =
    reconnectReplayContext;
  let { replayHydrationPromise } = reconnectReplayContext;
  const protocolReconcileAttempts = new Map();
  const isDeletedTurn = ({ sessionId = "", turnScopeId = "" } = {}) =>
    isTurnRuntimeDeleted(turnRuntimeRegistry?.value || turnRuntimeRegistry, { sessionId, turnScopeId });

  const applyRunStateEvent = (event) => dispatchAuthoritativeRunStateEvent?.(event);
  const applyRunStateEvents = (events) => {
    const sourceEvents = Array.isArray(events) ? events : [];
    return sourceEvents.map((event) => dispatchAuthoritativeRunStateEvent?.(event));
  };

  const applyWorkflowRuntimeEvent = (record = {}, { source = "reconnect" } = {}) => {
    const event = String(record?.event || "");
    const data = record?.data || {};
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
      return reduceWorkflowRuntimeEvent(record, { source });
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
      normalizeInteractionRequestPayload,
      tryAutoResolveInteraction,
      isInteractionRequestHandled,
      setPendingInteractionRequest,
      clearPendingInteraction,
      activeSession,
      connectorTypeSet,
      resolveConnectorStatusPayload,
      upsertConnectedConnectorInPanelState,
      refreshSessionConnectorsAsync,
      onAttachments: mergeAssistantAttachments,
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
      const result = applyWorkflowRuntimeEvent({
        event: "workflow_message_event",
        data: messageEvent,
        transportSequence: Number(packet?.seq || 0),
      }, { source: "reconnect" });
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
      isCurrentActiveSession,
      reconcileSessionState,
      hydrateActiveSessionBeforeReplay,
      applyTurnLifecycleEnvelope,
      applyTurnLifecycleSnapshot,
      applyPendingInteraction: (interaction) => applyReconnectInteractionRequest({
        eventData: interaction,
        normalizeInteractionRequestPayload,
        tryAutoResolveInteraction,
        isInteractionRequestHandled,
        setPendingInteractionRequest,
      }),
    });
  }

  async function hydrateActiveSessionBeforeReplay(sessionId = "", activeTurnSnapshot = null) {
    const requestedSessionId = String(sessionId || "").trim();
    if (!requestedSessionId || !isCurrentActiveSession(requestedSessionId)) return false;
    const presentationMessageId = String(activeTurnSnapshot?.presentationMessageId || "").trim();
    logStateMachineDebug("stateMachine.reconnect.presentationHydration.before", () => ({
      sessionId: requestedSessionId,
      dialogProcessId: String(activeTurnSnapshot?.dialogProcessId || "").trim(),
      turnScopeId: String(activeTurnSnapshot?.turnScopeId || "").trim(),
      presentationMessageId,
      messages: (Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages
        : []).map(summarizeStateMachineMessage),
    }));
    const hydrated = await renderActiveSessionBeforeReplay({
      activeSession,
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
    const presentationMessage = presentationMessageId
      ? findCanonicalMessageById?.(requestedSessionId, presentationMessageId)
      : null;
    const protocolViolation = presentationMessageId && !presentationMessage
      ? "presentation_missing"
      : "";
    logStateMachineDebug("stateMachine.reconnect.presentationHydration.after", () => ({
      sessionId: requestedSessionId,
      dialogProcessId: String(activeTurnSnapshot?.dialogProcessId || "").trim(),
      turnScopeId: String(activeTurnSnapshot?.turnScopeId || "").trim(),
      presentationMessageId,
      detailHydrated: hydrated === true,
      presentationHydratedFromDetail: Boolean(presentationMessage),
      presentationMaterialized: Boolean(presentationMessage),
      protocolViolation,
      presentationMessage: summarizeStateMachineMessage(presentationMessage),
      messages: (Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages
        : []).map(summarizeStateMachineMessage),
    }));
    return presentationMessageId ? Boolean(presentationMessage) : hydrated;
  }

  async function reconcileSessionState({
    sessionId = "",
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
          scrollToBottom: false,
        });
        detailApplied = true;
      }
    }
    return detailApplied;
  }

  function applyChannelState(stateData = {}) {
    // channel_state is transport-only. Recovery and business state are driven
    // exclusively by the Replay Batch snapshot and ordered Authority tail.
    return Promise.resolve({
      applied: false,
      reason: "transport_channel_state_ignored",
      sessionId: String(stateData?.sessionId || "").trim(),
      turnScopeId: String(stateData?.turnScopeId || "").trim(),
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

  function markReconnectSequenceApplied(sequence = 0, identity = {}) {
    markReconnectSequenceAppliedInConsumer(
      appliedReconnectSequenceByTurnKey,
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

  function logReconnectReplaySystemEvent(event, payload = {}) {
    sessionLogWebSocketClient?.log?.({
      category: "system",
      event,
      sessionId: payload?.sessionId || String(activeSession.value?.sessionId || ""),
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
    const sessionId = String(activeSession.value?.sessionId || "").trim();
    if (isDeletedTurn({ sessionId, turnScopeId })) {
      return { applied: false, reason: "deleted_turn_tombstoned" };
    }
    return applyReconnectMessagesToActiveSessionReplay({
      activeSession,
      activeSessionId,
      findCanonicalMessageById,
      findCanonicalMessagesById,
      chatList,
      messages,
      dialogProcessId,
      turnScopeId,
      appliedReconnectSequenceByTurnKey,
      appliedReconnectEventKindsByTurnKey,
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
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyTurnLifecycleEnvelope,
      applyExecutionSnapshot,
      applyExecutionChildren,
      applyExecutionTree,
      applyWorkflowRuntimeEvent,
      isDeletedTurn,
      onAttachmentLifecycle: (payload) => handleAttachmentLifecycleStreamEvent({
        data: payload,
        activeSession,
        makeViewMessage,
        logSessionEvent: ({ event, sessionId, dialogProcessId, turnScopeId, data: details }) =>
          logWorkflowDiagnostics(event, {
            sessionId,
            dialogProcessId,
            turnScopeId,
            ...(details || {}),
          }),
      }),
    });
  }

  return createReconnectReplayPublicApi({
    applyReconnectData,
    applyReconnectEvent,
    applyChannelState,
    replayCache,
    appliedReconnectSequenceByTurnKey,
    isTestMode: import.meta.env.MODE === "test",
  });
}
