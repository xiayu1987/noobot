/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import { useProcessStore } from "../../../shared/stores/useProcessStore";
import { buildChatPayload } from "./payload";
import {
  applySendErrorState,
  applyStopRequestedState,
  applyStreamCompletedFallback,
  finalizeSendCleanup,
} from "./sendFinalize";
import { prepareChatSend } from "./sendPrepare";
import {
  finalizeDoneSessionDetail,
  refreshFinalSessionDetail,
} from "./sessionFinalize";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./streamHandlers";
import { normalizeTrimmedString } from "./utils";
import {
  SESSION_RUN_EVENT,
  isInFlightSessionRunState,
} from "../sessionRunStateMachine";
import {
  getMessageRole,
  getMessageDialogProcessId,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { MESSAGE_IN_FLIGHT_CHANNEL_STATES } from "../sessionRunStateMachine/constants";
import { nowMs } from "../../infra/timeFields";
import {
  logResendDebug,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../debug/resendDebugLogger";

function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function isEventForCurrentTurn(data = {}, botMessage = {}) {
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  if (!botTurnScopeId) return true;
  return normalizeTrimmedString(data?.turnScopeId) === botTurnScopeId;
}

function isTerminalStopStateEvent(event = "", data = {}) {
  const normalizedEvent = normalizeTrimmedString(event);
  if (normalizedEvent === StreamEventEnum.STOPPED) return true;
  if (normalizedEvent !== StreamEventEnum.CHANNEL_STATE) return false;
  return ["stopped", "cancelled", "canceled"].includes(normalizeTrimmedString(data?.state));
}

function hasDialogProcessConflictForTurn({ activeSession, data = {}, botMessage = {} } = {}) {
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  if (!eventDialogProcessId || !eventTurnScopeId || !botTurnScopeId) return false;
  if (eventTurnScopeId !== botTurnScopeId) return false;
  const messages = Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages : [];
  return messages.some((messageItem) => {
    if (messageItem === botMessage) return false;
    if (getMessageDialogProcessId(messageItem) !== eventDialogProcessId) return false;
    const messageTurnScopeId = getMessageTurnScopeId(messageItem);
    return Boolean(messageTurnScopeId && messageTurnScopeId !== botTurnScopeId);
  });
}

function isInFlightAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== "assistant") return false;
  if (!getMessageTurnScopeId(messageItem)) return false;
  if (messageItem?.pending === true) return true;
  const channelState = normalizeTrimmedString(messageItem?.channelState?.state);
  return MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(channelState);
}

function hasMatchingInFlightAssistant({ activeSession, runStateSnapshot } = {}) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const runTurnScopeId = normalizeTrimmedString(runStateSnapshot?.value?.turnScopeId);
  if (!runTurnScopeId) return messages.some((messageItem) => isInFlightAssistantMessage(messageItem));
  return messages.some((messageItem) => (
    isInFlightAssistantMessage(messageItem) &&
    getMessageTurnScopeId(messageItem) === runTurnScopeId
  ));
}

function hasConsistentSendingState({ sending, activeSession, runStateSnapshot } = {}) {
  if (!sending?.value && !isInFlightSessionRunState(runStateSnapshot?.value?.state)) return true;
  return hasMatchingInFlightAssistant({ activeSession, runStateSnapshot });
}

export function createChatEngineSender({
  activeSession,
  activeSessionId,
  allowUserInteraction,
  applyConversationState,
  applyConversationStateFromEvent,
  applySessionDetail,
  appendMessage,
  botScenario,
  chatWebSocketClient,
  classifyRealtimeLog,
  clearMissingInteractionPayloadTimer,
  clearPendingInteraction,
  clearUploads,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  ensureConnected,
  fetchSessionDetail,
  foldMessagesForView,
  forceTool,
  input,
  interactionSubmitting,
  isImageMime,
  locale,
  locateSendingStartedMessage,
  locateDoneMessage,
  makeViewMessage,
  mergeAssistantAttachments,
  notify,
  pendingInteractionRequest,
  pluginModelConfig,
  refreshSessionConnectorsAsync,
  scrollBottom,
  selectedModel,
  selectedPlugins,
  sending,
  canStop,
  runStateSnapshot,
  applyRunStateEvent,
  serializeAttachments,
  streamOutput,
  translate,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
  uploadFiles,
  userId,
  finalizePendingResendOperation,
  processStore = null,
}) {
  let resolvedProcessStore = processStore || null;
  function getResolvedProcessStore() {
    if (resolvedProcessStore) return resolvedProcessStore;
    try {
      resolvedProcessStore = useProcessStore();
    } catch {
      resolvedProcessStore = null;
    }
    return resolvedProcessStore;
  }
  return async function send(options = {}) {
    const explicitMessageText = typeof options?.messageText === "string" ? options.messageText.trim() : "";
    const hasTextToSend = Boolean(explicitMessageText || input.value.trim());
    if (!ensureConnected()) return false;
    if (options?.allowDuringResend !== true && !hasConsistentSendingState({ sending, activeSession, runStateSnapshot })) {
      notify?.({
        type: "warning",
        message: translate("chat.sessionStateOutOfSync") || "Session state is out of sync. Refresh and try again.",
      });
      return false;
    }
    if ((sending.value && options?.allowDuringResend !== true) || !activeSession.value) return false;
    if (!hasTextToSend && uploadFiles.value.length === 0) return false;

    const turnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
    logResendDebug("send.begin", {
      sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId?.value || ""),
      turnScopeId,
      reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
      allowDuringResend: options?.allowDuringResend === true,
      sending: sending?.value,
      canStop: canStop?.value,
      runState: runStateSnapshot?.value,
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });
    chatWebSocketClient?.clearStopRequested?.();
    logResendDebug("send.clearStopRequested", { turnScopeId });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId?.value || ""),
      turnScopeId,
      source: "send_flow",
    });
    if (!applyRunStateEvent) {
      sending.value = true;
      if (canStop) canStop.value = true;
    }
    const {
      text,
      filesToSend,
      botMessage: botMsg,
      scrollOnFirstResponseOnce,
    } = prepareChatSend({
      input,
      uploadFiles,
      isImageMime,
      appendMessage,
      activeSession,
      applyConversationState,
      translate,
      scrollBottom,
      messageText: explicitMessageText,
      turnScopeId,
      reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
    });
    logResendDebug("send.prepare.after", {
      turnScopeId,
      botMessage: summarizeDebugMessage(botMsg),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    });

    let lastStreamErrorEventData = null;
    let finalDoneEventData = null;
    let finalStopEventData = null;
    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      const requestedTextStreaming = streamOutput?.value !== false;

      const payload = buildChatPayload({
        userId,
        activeSession,
        message: text,
        attachments,
        allowUserInteraction,
        forceTool,
        requestedTextStreaming,
        botScenario,
        selectedModel,
        pluginModelConfig,
        locale,
        selectedPlugins,
        turnScopeId,
        uploadHint: translate("chat.uploadHint"),
        reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
      });
      logResendDebug("send.stream.before", {
        turnScopeId,
        payloadTurnScopeId: payload?.turnScopeId,
        reuseExistingUserTurn: payload?.reuseExistingUserTurn,
        botMessage: summarizeDebugMessage(botMsg),
      });
      const activeProcessStore = getResolvedProcessStore();
      let locatedSendingStartedMessage = false;
      const locateSendingStartedMessageOnce = () => {
        // Do not navigate while the assistant response is still streaming.
        // The final navigation is performed once after DONE/finalize below.
        if (locatedSendingStartedMessage) return;
        locatedSendingStartedMessage = true;
      };

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
        logResendDebug("send.stream.event", {
          event,
          eventTurnScopeId: data?.turnScopeId,
          eventDialogProcessId: data?.dialogProcessId,
          state: data?.state,
          botMessage: summarizeDebugMessage(botMsg),
        });
        if (!isEventForCurrentTurn(data || {}, botMsg)) return;
        if (isTerminalStopStateEvent(event, data || {}) && hasDialogProcessConflictForTurn({
          activeSession,
          data: data || {},
          botMessage: botMsg,
        })) return;
        applyConversationStateFromEvent(event, data || {}, {
          botMessage: botMsg,
          fallbackDialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
          fallbackTurnScopeId: normalizeTrimmedString(botMsg.turnScopeId),
        });
        if (event === StreamEventEnum.CHANNEL_STATE) {
          const channelState = normalizeTrimmedString(data?.state);
          if (["stopped", "cancelled", "canceled"].includes(channelState)) {
            finalStopEventData = {
              ...(data || {}),
              sessionId: data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
              dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMsg.dialogProcessId),
            };
          }
          return;
        }
        if (event === StreamEventEnum.ERROR) {
          lastStreamErrorEventData = data || {};
          return;
        }
        if (
          handleBasicStreamEvent(event, {
            data,
            botMessage: botMsg,
            classifyRealtimeLog,
            scrollOnFirstResponseOnce,
            activeSession,
            connectorTypeSet,
            upsertConnectedConnectorInPanelState,
            refreshSessionConnectorsAsync,
            mergeAssistantAttachments,
            processStore: activeProcessStore,
            locateSendingStartedMessageOnce,
          })
        ) {
          return;
        }
        if (event === StreamEventEnum.INTERACTION_REQUEST) {
          handleInteractionRequestStreamEvent({
            data,
            clearMissingInteractionPayloadTimer,
            scrollOnFirstResponseOnce,
            tryAutoResolveInteraction,
            setPendingInteractionRequest,
          });
        } else if (event === StreamEventEnum.DONE) {
          finalDoneEventData = data || {};
          handleDoneStreamEvent({
            data,
            requestedTextStreaming,
            botMessage: botMsg,
            activeSession,
            activeSessionId,
            clearPendingInteraction,
            classifyRealtimeLog,
            scrollOnFirstResponseOnce,
            makeViewMessage,
            foldMessagesForView,
            mergeAssistantAttachments,
            locateDoneMessage,
            applyConversationState,
            processStore: activeProcessStore,
            locateSendingStartedMessageOnce,
          });
        } else if (event === StreamEventEnum.STOPPED) {
          finalStopEventData = {
            ...(data || {}),
            sessionId: data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
            dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMsg.dialogProcessId),
          };
        }
      });

      // Safety net: if terminal channel_state is delayed/lost, avoid sticky "stop" UI.
      // Primary source of truth remains channel_state; this fallback only runs when
      // stream is already ended and UI is still in-flight.
      applyStreamCompletedFallback({
        sending,
        finalDoneEventData,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
      });

      const stoppedByFinalEvent = Boolean(finalStopEventData);
      const stoppedByStopRequest = applyStopRequestedState({
        chatWebSocketClient,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
      });
      logResendDebug("send.stopCheck", {
        turnScopeId,
        stoppedByFinalEvent,
        stoppedByStopRequest,
        finalStopEventData,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      if (stoppedByFinalEvent || stoppedByStopRequest) {
        if (stoppedByFinalEvent && !stoppedByStopRequest) {
          applyStopRequestedState({
            chatWebSocketClient: { isStopRequested: () => true },
            activeSession,
            botMessage: botMsg,
            applyConversationState,
          });
        }
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
        logResendDebug("send.stopReturn", {
          turnScopeId,
          sending: sending?.value,
          canStop: canStop?.value,
          runState: runStateSnapshot?.value,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        return;
      }

      await finalizeDoneSessionDetail({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        finalDoneEventData,
        fetchSessionDetail,
        applySessionDetail,
        refreshSessionConnectorsAsync,
      });
      locateDoneMessage?.();
      finalizePendingResendOperation?.({ finalOnly: true });
      logResendDebug("send.doneReturn", {
        turnScopeId,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      return true;
    } catch (error) {
      if (
        applyStopRequestedState({
          chatWebSocketClient,
          activeSession,
          botMessage: botMsg,
          applyConversationState,
        })
      ) {
        logResendDebug("send.catch.stopRequested", {
          turnScopeId,
          messages: summarizeDebugMessages(activeSession?.value?.messages),
        });
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
        return false;
      }
      applySendErrorState({
        error,
        errorEventData: lastStreamErrorEventData || error?.data || null,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
        clearPendingInteraction,
        notify,
        translate,
      });
      logResendDebug("send.catch.error", {
        turnScopeId,
        error: String(error?.message || error || ""),
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      await finalizeDoneSessionDetail({
        activeSession,
        activeSessionId,
        botMessage: botMsg,
        finalDoneEventData: lastStreamErrorEventData || error?.data || null,
        fetchSessionDetail,
        applySessionDetail,
        refreshSessionConnectorsAsync,
      });
      return false;
    } finally {
      logResendDebug("send.cleanup", {
        turnScopeId,
        sending: sending?.value,
        canStop: canStop?.value,
        runState: runStateSnapshot?.value,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      });
      finalizeSendCleanup({
        chatWebSocketClient,
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  };
}
