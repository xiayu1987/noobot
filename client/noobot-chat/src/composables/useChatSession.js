/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { storeToRefs } from "pinia";
import { applyCompletedToolLogsToMessages } from "./sessionToolLogs";
import {
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
} from "./messageModel";
import {
  buildChatWebSocketUrl,
  deleteSessionApi,
  getSessionConnectorsApi,
  getSessionDetailApi,
  getSessionsApi,
} from "../api/chatApi";
import { encryptPayloadBySessionId } from "../utils/sessionCrypto";
import { RoleEnum } from "../constants/chatConstants";
import {
  createConnectorPanelState,
  generateSessionId,
  sessionTitleFromMessages,
} from "../models/sessionModel";
import { createChatWebSocketClient } from "../services/chatWebSocketClient";
import { useChatInput } from "./useChatInput";
import { useAgentInteraction } from "./useAgentInteraction";
import { useConnectorPanel } from "./useConnectorPanel";
import { useChatList } from "./useChatList";
import { useChatEngine } from "./useChatEngine";
import { useChatStore } from "../stores/useChatStore";

export function useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  connected,
  ensureConnected,
  authFetch,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  clearUploadSelection = () => {},
}) {
  const chatStore = useChatStore();
  const {
    sending,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
  } = storeToRefs(chatStore);

  const {
    input,
    uploadFiles,
    onUploadChange,
    clearUploads,
    serializeAttachments,
  } = useChatInput({
    isImageMime,
    clearUploadSelection,
  });

  const chatWebSocketClient = createChatWebSocketClient({
    resolveWebSocketUrl: () =>
      buildChatWebSocketUrl({ apiKey: apiKey.value || "" }),
  });

  const {
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    setPendingInteractionRequest,
    submitInteractionResponse,
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

  function appendMessage(role, content = "", attachmentMetas = []) {
    const msg = reactive(buildAppendMessage(role, content, attachmentMetas));
    activeSession.value.messages.push(msg);
    activeSession.value.rawMessages.push(msg);
    activeSession.value.messageCount = (activeSession.value.messageCount || 0) + 1;
    activeSession.value.lastMessage = msg;
    activeSession.value.updatedAt = new Date().toISOString();
    return msg;
  }

  function makeViewMessage(messageItem = {}) {
    return reactive(
      buildViewMessage(messageItem, {
        userId: userId.value,
        apiKey: apiKey.value,
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
    createConnectorPanelState,
    generateSessionId,
    sessionTitleFromMessages,
    applyCompletedToolLogsToMessages,
    getSessionsApi,
    getSessionDetailApi,
    deleteSessionApi,
    makeViewMessage,
    foldMessagesForView,
    scrollBottom,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    clearUploads,
  });

  const chatEngine = useChatEngine({
    userId,
    allowUserInteraction,
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
    fetchSessionDetail: chatList.fetchSessionDetail,
    applySessionDetail: chatList.applySessionDetail,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    connectorTypeSet: connectorPanel.connectorTypeSet,
    upsertConnectedConnectorInPanelState:
      connectorPanel.upsertConnectedConnectorInPanelState,
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction,
    setPendingInteractionRequest,
    submitInteractionResponse,
    chatWebSocketClient,
    ensureConnected,
  });

  function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
    if (isMobileRef.value) mobileSidebarOpenRef.value = false;
  }

  function shouldRenderMessageInChat(messageItem) {
    const messageRole = String(messageItem?.role || "");
    return messageRole !== RoleEnum.TOOL;
  }

  return {
    input,
    uploadFiles,
    sending,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    newSession: chatList.newSession,
    deleteSession: chatList.deleteSession,
    fetchSessions: chatList.fetchSessions,
    selectSession: chatList.selectSession,
    send: chatEngine.send,
    stopSending: chatEngine.stopSending,
    refreshSessionConnectors: connectorPanel.refreshSessionConnectors,
    refreshSessionConnectorsAsync: connectorPanel.refreshSessionConnectorsAsync,
    updateSessionSelectedConnector: connectorPanel.updateSessionSelectedConnector,
    pendingInteractionRequest,
    interactionSubmitting,
    submitInteractionResponse,
    onUploadChange,
    clearUploads,
    shouldRenderMessageInChat,
    closeMobileSidebarOnSelect,
    releaseAllPreviewUrls: chatList.releaseAllPreviewUrls,
    initSessionsAfterMount: chatList.initSessionsAfterMount,
  };
}
