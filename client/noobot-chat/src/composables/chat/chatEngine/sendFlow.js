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
import { finalizeDoneSessionDetail, refreshFinalSessionDetail } from "./sessionFinalize";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./streamHandlers";
import { normalizeTrimmedString } from "./utils";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine";
import { nowMs } from "../../infra/timeFields";

function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
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
    if (sending.value || !activeSession.value) return false;
    if (!hasTextToSend && uploadFiles.value.length === 0) return false;

    const turnScopeId = normalizeTrimmedString(options?.turnScopeId) || createTurnScopeId();
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
      skipUserMessageAppend: options?.skipUserMessageAppend === true,
      existingUserMessage: options?.existingUserMessage || null,
      messageText: explicitMessageText,
      turnScopeId,
    });

    let lastStreamErrorEventData = null;
    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;
      let finalStopEventData = null;
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
      const activeProcessStore = getResolvedProcessStore();
      let locatedSendingStartedMessage = false;
      const locateSendingStartedMessageOnce = () => {
        // Do not navigate while the assistant response is still streaming.
        // The final navigation is performed once after DONE/finalize below.
        if (locatedSendingStartedMessage) return;
        locatedSendingStartedMessage = true;
      };

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
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
      if (stoppedByFinalEvent || stoppedByStopRequest) {
        if (stoppedByFinalEvent && !stoppedByStopRequest) {
          applyStopRequestedState({
            chatWebSocketClient: { isStopRequested: () => true },
            activeSession,
            botMessage: botMsg,
            applyConversationState,
          });
        }
        await refreshFinalSessionDetail({
          activeSession,
          activeSessionId,
          botMessage: botMsg,
          finalEventData: finalStopEventData || {
            sessionId: activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
            dialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
          },
          fetchSessionDetail,
          applySessionDetail,
          refreshSessionConnectorsAsync,
          preserveCurrentMessages: false,
        });
        locateDoneMessage?.();
        finalizePendingResendOperation?.({ finalOnly: true });
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
        await refreshFinalSessionDetail({
          activeSession,
          activeSessionId,
          botMessage: botMsg,
          finalEventData: finalStopEventData || {
            sessionId: activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
            dialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
          },
          fetchSessionDetail,
          applySessionDetail,
          refreshSessionConnectorsAsync,
          preserveCurrentMessages: false,
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
      finalizeSendCleanup({
        chatWebSocketClient,
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  };
}
