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
import { mergeAttachmentMetas } from "../infra/dialogProcessChain";
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
  hasAssistantMessageWithContent as hasAssistantMessageWithContentWithContext,
  mergeAssistantAttachmentMetas as mergeAssistantAttachmentMetasWithContext,
  resolveReconnectTargetAssistantMessage as resolveReconnectTargetAssistantMessageWithContext,
} from "./reconnectReplay/messageReplay";
import {
  applyDoneMessagesFromReconnect as applyDoneMessagesFromReconnectWithContext,
} from "./reconnectReplay/doneReplay";
import { createReconnectReplayPublicApi } from "./reconnectReplay/publicApi";
import { registerReconnectReplayLifecycleCleanup } from "./reconnectReplay/lifecycle";
import { applySessionRunStateEvent, applySessionRunStateEvents } from "./sessionRunStateMachine";

export function useReconnectReplay({
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
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  classifyRealtimeLog,
  scrollBottom,
  translate,
  onConversationState,
  notify = () => {},
  processStore,
} = {}) {
  const reconnectReplayContext = createReconnectReplayContext();
  const { replayCache, appliedReconnectSeqByDialogProcessId, terminalDialogProcessIdSet, missingInteractionPayloadTimers } =
    reconnectReplayContext;
  let { cacheExpiredRefreshTimer, replayHydrationPromise } = reconnectReplayContext;

  const applyRunStateEvent = (event) => applySessionRunStateEvent({
    stateRef: runStateSnapshot,
    sending,
    canStop,
    event,
  });

  const applyRunStateEvents = (events) => applySessionRunStateEvents({
    stateRef: runStateSnapshot,
    sending,
    canStop,
    events,
  });

  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    return applyAssistantFailureStateWithContext({ targetAssistantMessage, errorMessage, translate });
  }

  function mergeAssistantAttachmentMetas(targetAssistantMessage, attachmentMetas = []) {
    return mergeAssistantAttachmentMetasWithContext({
      targetAssistantMessage,
      attachmentMetas,
      makeViewMessage,
      mergeAttachmentMetas,
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
      onAttachmentMetas: mergeAssistantAttachmentMetas,
      onDoneMessages: applyDoneMessagesFromReconnect,
    });
  }

  function emitSyntheticErrorConversationState({
    sessionId = "",
    dialogProcessId = "",
    sourceEvent = "",
  } = {}) {
    return emitSyntheticReconnectErrorConversationState({
      onConversationState,
      sessionId,
      dialogProcessId,
      sourceEvent,
    });
  }

  function scheduleMissingInteractionPayloadFailure({
    sessionId = "",
    dialogProcessId = "",
    targetAssistantMessage = null,
  } = {}) {
    return scheduleMissingInteractionPayloadFailureWithContext({
      pendingInteractionRequest,
      missingInteractionPayloadTimers,
      sessionId,
      dialogProcessId,
      targetAssistantMessage,
      sending,
      canStop,
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
      sending,
      canStop,
      applyRunStateEvents,
      isCurrentActiveSession,
      resolveReconnectTargetAssistantMessage,
      replayCache,
      applyReconnectMessagesToActiveSession,
      applyChannelState,
      scheduleCacheExpiredSessionRefresh,
    });
  }

  function applyChannelState(stateData = {}) {
    return applyReconnectChannelState({
      stateData,
      onConversationState,
      isCurrentActiveSession,
      findAssistantMessageByDialogProcessId,
      findFallbackAssistantMessage: findReconnectChannelStateFallbackAssistant,
      sending,
      canStop,
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
    { allowCreate = true } = {},
  ) {
    return resolveReconnectTargetAssistantMessageWithContext({
      activeSession,
      appendMessage,
      dialogProcessId,
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
      sending,
      canStop,
      interactionSubmitting,
      clearPendingInteraction,
      translate,
      activeSession,
      activeSessionId,
      chatList,
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

  function markReconnectSequenceApplied(dialogProcessId = "", sequence = 0) {
    markReconnectSequenceAppliedInConsumer(
      appliedReconnectSeqByDialogProcessId,
      dialogProcessId,
      sequence,
    );
  }

  function findAssistantMessageByDialogProcessId(dialogProcessId = "") {
    return findAssistantMessageByDialogProcessIdWithContext(activeSession, dialogProcessId);
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

  async function applyReconnectMessagesToActiveSession(
    messages,
    dialogProcessId,
    { allowCreate = true } = {},
  ) {
    return applyReconnectMessagesToActiveSessionReplay({
      activeSession,
      activeSessionId,
      appendMessage,
      chatList,
      messages,
      dialogProcessId,
      allowCreate,
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
      scrollBottom,
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
