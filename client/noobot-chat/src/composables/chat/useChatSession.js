/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { storeToRefs } from "pinia";
import { applyCompletedToolLogsToMessages } from "../infra/sessionToolLogs";
import {
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
} from "../infra/messageModel";
import {
  buildChatWebSocketUrl,
  deleteSessionApi,
  getSessionConnectorsApi,
  getSessionDetailApi,
  getSessionsApi,
} from "../../services/api/chatApi";
import { encryptPayloadBySessionId } from "../../shared/utils/sessionCrypto";
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";
import {
  createConnectorPanelState,
  generateSessionId,
  sessionTitleFromMessages,
} from "../../shared/models/sessionModel";
import { createChatWebSocketClient } from "../../services/ws/chatWebSocketClient";
import { useChatInput } from "./useChatInput";
import { useAgentInteraction } from "./useAgentInteraction";
import { useConnectorPanel } from "../infra/useConnectorPanel";
import { useChatList } from "./useChatList";
import { useChatEngine } from "./useChatEngine";
import { useChatStore } from "../../shared/stores/useChatStore";
import { useLocale } from "../../shared/i18n/useLocale";

export function useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  botScenario,
  connected,
  ensureConnected,
  authFetch,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  notify = () => {},
  clearUploadSelection = () => {},
}) {
  const { translate } = useLocale();
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
    appendUploads,
    clearUploads,
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
    notify,
  });

  const chatEngine = useChatEngine({
    userId,
    allowUserInteraction,
    botScenario,
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
    notify,
  });

  async function handleReconnect() {
    return chatWebSocketClient.reconnect({
      currentSessionId: String(activeSession.value?.backendSessionId || activeSessionId.value || ""),
      onReconnectData: (reconnectPayload) => {
        if (reconnectPayload?.sessions) {
          applyReconnectData(reconnectPayload);
        }
        if (reconnectPayload?.event && reconnectPayload?.data) {
          applyReconnectEvent(reconnectPayload.event, reconnectPayload.data);
        }
      },
    }).catch((error) => {
      console.warn("Reconnect failed:", error);
      notify({ type: "warning", message: translate("infra.reconnectFailed") });
    });
  }

  const replayCache = {};
  const appliedReconnectSeqByDialogProcessId = {};

  function getActiveSessionIdCandidates() {
    return new Set(
      [
        activeSession.value?.backendSessionId,
        activeSession.value?.id,
        activeSessionId.value,
      ]
        .map((sessionId) => String(sessionId || "").trim())
        .filter(Boolean),
    );
  }

  function isCurrentActiveSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return false;
    return getActiveSessionIdCandidates().has(normalizedSessionId);
  }

  function applyReconnectData(reconnectData) {
    const sessions = Array.isArray(reconnectData?.sessions) ? reconnectData.sessions : [];
    for (const sessionEntry of sessions) {
      const sessionId = String(sessionEntry?.sessionId || "").trim();
      if (!sessionId) continue;
      const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : [];
      for (const dp of dialogProcesses) {
        const dpId = String(dp?.dialogProcessId || "").trim();
        const messages = Array.isArray(dp?.messages) ? dp.messages : [];
        if (!dpId || !messages.length) continue;
        if (!isCurrentActiveSession(sessionId)) {
          if (!replayCache[sessionId]) replayCache[sessionId] = {};
          replayCache[sessionId][dpId] = messages;
        } else {
          applyReconnectMessagesToActiveSession(messages, dpId);
        }
      }
    }
    if (reconnectData?.cacheExpired) {
      chatList.fetchSessions(String(activeSessionId.value || ""));
    }
  }

  function resolveReconnectTargetAssistantMessage(
    dialogProcessId = "",
    { allowCreate = true } = {},
  ) {
    if (!activeSession.value) return;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const matchedAssistantMessage = (activeSession.value.messages || []).find(
      (messageItem) =>
        normalizedDpId &&
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
    );
    if (matchedAssistantMessage) {
      return matchedAssistantMessage.pending ? matchedAssistantMessage : null;
    }
    const latestPendingAssistant = [...(activeSession.value.messages || [])]
      .reverse()
      .find(
        (messageItem) =>
          String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
          Boolean(messageItem?.pending),
      );
    if (latestPendingAssistant) {
      if (normalizedDpId && !String(latestPendingAssistant?.dialogProcessId || "").trim()) {
        latestPendingAssistant.dialogProcessId = normalizedDpId;
      }
      return latestPendingAssistant;
    }
    if (!allowCreate) return null;
    const appendedMessage = appendMessage(RoleEnum.ASSISTANT, "");
    appendedMessage.pending = true;
    appendedMessage.statusLabel = "";
    if (normalizedDpId) {
      appendedMessage.dialogProcessId = normalizedDpId;
    }
    return appendedMessage;
  }

  function finalizeReconnectTerminalState() {
    sending.value = false;
    clearPendingInteraction();
    chatWebSocketClient.clearStopRequested();
    interactionSubmitting.value = false;
  }

  function getReconnectEnvelopeSequence(envelope = {}) {
    return Number(envelope?.data?.seq || envelope?.sequence || 0);
  }

  function isReconnectTerminalBatch(messages = []) {
    return (Array.isArray(messages) ? messages : []).some((envelope) =>
      [
        StreamEventEnum.DONE,
        StreamEventEnum.STOPPED,
        StreamEventEnum.ERROR,
      ].includes(String(envelope?.event || "").trim()),
    );
  }

  function applyReconnectMessagesToActiveSession(messages, dialogProcessId) {
    if (!activeSession.value) return;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const lastAppliedSeq = Number(appliedReconnectSeqByDialogProcessId[normalizedDpId] || 0);
    const nextMessages = (Array.isArray(messages) ? messages : []).filter((envelope) => {
      const sequence = getReconnectEnvelopeSequence(envelope);
      return !sequence || sequence > lastAppliedSeq;
    });
    if (!nextMessages.length) return;
    const allowCreate = !isReconnectTerminalBatch(nextMessages);
    const targetMessage = resolveReconnectTargetAssistantMessage(normalizedDpId, {
      allowCreate,
    });
    if (!targetMessage) return;
    let maxAppliedSeq = lastAppliedSeq;
    for (const envelope of nextMessages) {
      maxAppliedSeq = Math.max(maxAppliedSeq, getReconnectEnvelopeSequence(envelope));
      const eventName = String(envelope?.event || "").trim();
      const eventData = envelope?.data || {};
      if (eventName === StreamEventEnum.DELTA) {
        targetMessage.content += String(eventData?.text || "");
      } else if (eventName === StreamEventEnum.THINKING) {
        const logItem = classifyRealtimeLog(eventData);
        if (logItem?.dialogProcessId && !String(targetMessage?.dialogProcessId || "").trim()) {
          targetMessage.dialogProcessId = String(logItem.dialogProcessId || "").trim();
        }
        targetMessage.executionLogTotal = Number(targetMessage.executionLogTotal || 0) + 1;
        targetMessage.realtimeLogs = [...(targetMessage.realtimeLogs || []), logItem].slice(-10);
      } else if (eventName === StreamEventEnum.DONE) {
        targetMessage.pending = false;
        targetMessage.statusLabel = translate("chat.generated");
        finalizeReconnectTerminalState();
      } else if (eventName === StreamEventEnum.STOPPED) {
        targetMessage.pending = false;
        targetMessage.statusLabel = translate("chat.stopped");
        finalizeReconnectTerminalState();
      } else if (eventName === StreamEventEnum.ERROR) {
        targetMessage.pending = false;
        targetMessage.statusLabel = translate("chat.failed");
        targetMessage.error = String(eventData?.error || targetMessage?.error || "");
        finalizeReconnectTerminalState();
      }
    }
    if (normalizedDpId && maxAppliedSeq > lastAppliedSeq) {
      appliedReconnectSeqByDialogProcessId[normalizedDpId] = maxAppliedSeq;
    }
    scrollBottom();
  }

  function applyReconnectEvent(event, data) {
    const dpId = String(data?.dialogProcessId || "").trim();
    const sessionId = String(data?.sessionId || "").trim();
    if (sessionId && isCurrentActiveSession(sessionId)) {
      applyReconnectMessagesToActiveSession([{ event, data }], dpId);
      return;
    }
    if (event === "delta" && sessionId && dpId) {
      if (!replayCache[sessionId]) replayCache[sessionId] = {};
      if (!replayCache[sessionId][dpId]) replayCache[sessionId][dpId] = [];
      replayCache[sessionId][dpId].push({ event, data });
    }
  }

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
    appendUploads,
    clearUploads,
    shouldRenderMessageInChat,
    closeMobileSidebarOnSelect,
    releaseAllPreviewUrls: chatList.releaseAllPreviewUrls,
    initSessionsAfterMount: chatList.initSessionsAfterMount,
    chatWebSocketClient,
    handleReconnect,
  };
}
