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
import { finalizeDoneSessionDetail } from "./sessionFinalize";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./streamHandlers";
import { normalizeTrimmedString } from "./utils";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine";

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
  locateDoneMessage,
  makeViewMessage,
  mergeAssistantAttachmentMetas,
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

    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || activeSessionId?.value || ""),
      dialogProcessId: normalizeTrimmedString(options?.existingUserTurnId || options?.existingUserMessageId || ""),
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
    });

    let lastStreamErrorEventData = null;
    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;
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
        uploadHint: translate("chat.uploadHint"),
        reuseExistingUserTurn: options?.reuseExistingUserTurn === true,
        existingUserTurnId: options?.existingUserTurnId || "",
        existingUserMessageId: options?.existingUserMessageId || "",
      });
      const activeProcessStore = getResolvedProcessStore();

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
        applyConversationStateFromEvent(event, data || {}, {
          botMessage: botMsg,
          fallbackDialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
        });
        if (event === StreamEventEnum.CHANNEL_STATE) {
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
            mergeAssistantAttachmentMetas,
            processStore: activeProcessStore,
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
            mergeAssistantAttachmentMetas,
            locateDoneMessage,
            processStore: activeProcessStore,
          });
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

      if (
        applyStopRequestedState({
          chatWebSocketClient,
          activeSession,
          botMessage: botMsg,
          applyConversationState,
        })
      ) {
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
