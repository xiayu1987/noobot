/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { StreamEventEnum } from "../../shared/constants/chatConstants";
import { mergeAttachmentMetas } from "../infra/dialogProcessChain";
import { useLocale } from "../../shared/i18n/useLocale";
import { createChatEngineConversationState } from "./chatEngine/conversationState";
import { buildChatPayload } from "./chatEngine/payload";
import {
  applySendErrorState,
  applyStopRequestedState,
  applyStreamCompletedFallback,
  finalizeSendCleanup,
} from "./chatEngine/sendFinalize";
import { prepareChatSend } from "./chatEngine/sendPrepare";
import { finalizeDoneSessionDetail } from "./chatEngine/sessionFinalize";
import {
  forceStopUiFinalize as finalizeForceStopUi,
  stopSending as requestStopSending,
} from "./chatEngine/stop";
import {
  handleBasicStreamEvent,
  handleDoneStreamEvent,
  handleInteractionRequestStreamEvent,
} from "./chatEngine/streamHandlers";
import { normalizeTrimmedString } from "./chatEngine/utils";

export function useChatEngine({
  userId,
  allowUserInteraction,
  forceTool,
  streamOutput,
  botScenario,
  selectedPlugins,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  activeSession,
  activeSessionId,
  sending,
  input,
  uploadFiles,
  clearUploads,
  serializeAttachments,
  appendMessage,
  makeViewMessage,
  foldMessagesForView,
  fetchSessionDetail,
  applySessionDetail,
  refreshSessionConnectorsAsync,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  pendingInteractionRequest,
  interactionSubmitting,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  submitInteractionResponse,
  refreshSessionsAsync,
  onConversationState,
  chatWebSocketClient,
  ensureConnected,
  notify = () => {},
} = {}) {
  const { translate, locale } = useLocale();
  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    if (!targetAssistantMessage) return;
    targetAssistantMessage.pending = false;
    targetAssistantMessage.statusLabel = translate("chat.failed");
    targetAssistantMessage.error = String(errorMessage || "").trim();
    if (!String(targetAssistantMessage.content || "").trim()) {
      targetAssistantMessage.content = `> ${translate("chat.occurredError", {
        error: targetAssistantMessage.error || translate("chat.unknownError"),
      })}`;
    }
  }

  function mergeAssistantAttachmentMetas(targetAssistantMessage, attachmentMetas = []) {
    if (!targetAssistantMessage || !Array.isArray(attachmentMetas) || !attachmentMetas.length) {
      return;
    }
    const normalizedAttachmentMetas =
      makeViewMessage({ attachmentMetas })?.attachmentMetas || attachmentMetas;
    targetAssistantMessage.attachmentMetas = mergeAttachmentMetas(
      Array.isArray(targetAssistantMessage.attachmentMetas)
        ? targetAssistantMessage.attachmentMetas
        : [],
      normalizedAttachmentMetas,
    );
  }

  const {
    applyConversationState,
    applyConversationStateFromEvent,
    clearMissingInteractionPayloadTimer,
    disposeConversationState,
    findTargetAssistantMessage,
    tryAutoResolveInteraction,
  } = createChatEngineConversationState({
    activeSession,
    activeSessionId,
    sending,
    interactionSubmitting,
    pendingInteractionRequest,
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    setPendingInteractionRequest,
    submitInteractionResponse,
    refreshSessionsAsync,
    onConversationState,
    connectorTypeSet,
    upsertConnectedConnectorInPanelState,
    refreshSessionConnectorsAsync,
    notify,
    translate,
    applyAssistantFailureState,
  });

  function forceStopUiFinalize() {
    return finalizeForceStopUi({
      sending,
      activeSession,
      findTargetAssistantMessage,
      applyConversationState,
      chatWebSocketClient,
    });
  }

  function stopSending() {
    return requestStopSending({
      sending,
      activeSession,
      chatWebSocketClient,
      onForceStopUiFinalize: forceStopUiFinalize,
    });
  }

  async function send() {
    if (!ensureConnected()) return;
    if (sending.value || !activeSession.value) return;
    if (!input.value.trim() && uploadFiles.value.length === 0) return;

    sending.value = true;
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
    });

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
        locale,
        selectedPlugins,
        uploadHint: translate("chat.uploadHint"),
      });

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
        applyConversationStateFromEvent(event, data || {}, {
          botMessage: botMsg,
          fallbackDialogProcessId: normalizeTrimmedString(botMsg.dialogProcessId),
        });
        if (event === StreamEventEnum.CHANNEL_STATE) {
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
            scrollBottom,
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
    } catch (error) {
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
      applySendErrorState({
        error,
        activeSession,
        botMessage: botMsg,
        applyConversationState,
        clearPendingInteraction,
        notify,
        translate,
      });
    } finally {
      finalizeSendCleanup({
        chatWebSocketClient,
        pendingInteractionRequest,
        interactionSubmitting,
      });
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposeConversationState();
    });
  }

  return {
    send,
    stopSending,
  };
}
