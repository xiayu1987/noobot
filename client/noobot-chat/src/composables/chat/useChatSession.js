/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive } from "vue";
import { storeToRefs } from "pinia";
import { applyCompletedToolLogsToMessages } from "../infra/sessionToolLogs";
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  isCurrentActiveSessionId,
  promoteSessionIdentityToBackendId,
} from "../infra/sessionIdentity";
import {
  collectReconnectDeltaText,
  findLatestPendingAssistantAfterLastUser,
  findRecoverableReconnectSessionId,
  findReconnectDoneEnvelopeWithMessages,
  findReusableMessageObject,
  getReconnectEnvelopeSequence,
  getReconnectMaxSequence,
  isDialogProcessRecoverable,
  isPendingInteractionReplay,
  isReconnectTerminalBatch,
  isReconnectTerminalEvent,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
  resolveDialogProcessIdFromReplay,
  splitReconnectMessagesByDialogProcessId,
} from "../infra/reconnectReplayModel";
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
import { normalizeInteractionRequestPayload } from "./interactionPayload";
import { useChatStore } from "../../shared/stores/useChatStore";
import { useLocale } from "../../shared/i18n/useLocale";

export function useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  forceTool,
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
    markInteractionRequestHandled,
    isInteractionRequestHandled,
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
    forceTool,
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
  let cacheExpiredRefreshTimer = null;

  function isCurrentActiveSession(sessionId = "") {
    return isCurrentActiveSessionId({
      sessionId,
      activeSession: activeSession.value,
      activeSessionId: activeSessionId.value,
    });
  }

  async function ensureReconnectSessionActive(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || isCurrentActiveSession(normalizedSessionId)) return true;
    const targetSession = findSessionByAnyIdInList(sessions.value, normalizedSessionId);
    if (!targetSession) {
      await chatList.fetchSessions(normalizedSessionId, {
        silent: true,
        preserveCurrentMessages: true,
      });
    }
    const resolvedTargetSession = findSessionByAnyIdInList(
      sessions.value,
      normalizedSessionId,
    );
    if (!resolvedTargetSession) return false;
    await chatList.selectSession(resolvedTargetSession.id, {
      force: true,
      silent: true,
      preserveCurrentMessages: true,
    });
    return isCurrentActiveSession(normalizedSessionId);
  }

  async function applyReconnectData(reconnectData) {
    const reconnectSessions = Array.isArray(reconnectData?.sessions)
      ? reconnectData.sessions
      : [];
    const recoverableSessionId = findRecoverableReconnectSessionId(reconnectSessions);
    if (recoverableSessionId) {
      await ensureReconnectSessionActive(recoverableSessionId);
      sending.value = true;
      const recoverableSessionEntry = reconnectSessions.find(
        (sessionEntry) =>
          String(sessionEntry?.sessionId || "").trim() === recoverableSessionId,
      );
      const recoverableDialogProcesses = Array.isArray(
        recoverableSessionEntry?.dialogProcesses,
      )
        ? recoverableSessionEntry.dialogProcesses
        : [];
      const hasReconnectMessages = recoverableDialogProcesses.some(
        (dialogProcess) =>
          Array.isArray(dialogProcess?.messages) && dialogProcess.messages.length,
      );
      if (!hasReconnectMessages && isCurrentActiveSession(recoverableSessionId)) {
        resolveReconnectTargetAssistantMessage("", { allowCreate: true });
      }
    }

    for (const sessionEntry of reconnectSessions) {
      const sessionId = String(sessionEntry?.sessionId || "").trim();
      if (!sessionId) continue;
      const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : [];
      for (const dp of dialogProcesses) {
        const dpMessages = Array.isArray(dp?.messages) ? dp.messages : [];
        if (!dpMessages.length) continue;
        for (const replayGroup of splitReconnectMessagesByDialogProcessId(
          dpMessages,
          dp?.dialogProcessId || "",
        )) {
          const messages = replayGroup.messages;
          const dpId = resolveDialogProcessIdFromReplay(
            messages,
            replayGroup.dialogProcessId || dp?.dialogProcessId || "",
          );
          if (!messages.length) continue;
          if (!isCurrentActiveSession(sessionId)) {
            const replayKey = dpId || `__unknown_${Date.now()}_${Math.random()}`;
            if (!replayCache[sessionId]) replayCache[sessionId] = {};
            replayCache[sessionId][replayKey] = messages;
          } else {
            applyReconnectMessagesToActiveSession(messages, dpId, {
              allowCreate: isDialogProcessRecoverable(sessionEntry, messages),
            });
          }
        }
      }
    }

    if (reconnectData?.cacheExpired) {
      scheduleCacheExpiredSessionRefresh();
    }
  }

  function resolveReconnectTargetAssistantMessage(
    dialogProcessId = "",
    { allowCreate = true } = {},
  ) {
    if (!activeSession.value) return;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const messageList = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const matchedAssistantMessage = messageList.find(
      (messageItem) =>
        normalizedDpId &&
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
    );
    if (matchedAssistantMessage) {
      return matchedAssistantMessage.pending ? matchedAssistantMessage : null;
    }

    const latestPendingAssistant = findLatestPendingAssistantAfterLastUser(messageList);
    if (latestPendingAssistant) {
      const latestPendingDpId = String(latestPendingAssistant?.dialogProcessId || "").trim();
      // Never write a replay for dialogProcess A into a pending assistant that
      // already belongs to dialogProcess B. That is the main cause of replay
      // touching the previous turn.
      if (normalizedDpId && latestPendingDpId && latestPendingDpId !== normalizedDpId) {
        return null;
      }
      if (normalizedDpId && !latestPendingDpId) {
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

  function scheduleCacheExpiredSessionRefresh() {
    if (cacheExpiredRefreshTimer) clearTimeout(cacheExpiredRefreshTimer);
    cacheExpiredRefreshTimer = setTimeout(() => {
      cacheExpiredRefreshTimer = null;
      chatList.fetchSessions(String(activeSessionId.value || ""), {
        silent: true,
        preserveCurrentMessages: true,
      });
    }, 1200);
  }

  function markReconnectSequenceApplied(dialogProcessId = "", sequence = 0) {
    const normalizedDpId = String(dialogProcessId || "").trim();
    const normalizedSequence = Number(sequence || 0);
    if (!normalizedDpId || normalizedSequence <= 0) return;
    const lastAppliedSeq = Number(appliedReconnectSeqByDialogProcessId[normalizedDpId] || 0);
    if (normalizedSequence > lastAppliedSeq) {
      appliedReconnectSeqByDialogProcessId[normalizedDpId] = normalizedSequence;
    }
  }

  function findAssistantMessageByDialogProcessId(dialogProcessId = "") {
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (!normalizedDpId || !activeSession.value) return null;
    return (activeSession.value.messages || []).find(
      (messageItem) =>
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
    ) || null;
  }

  function hasAssistantMessageWithContent(content = "") {
    const normalizedContent = String(content || "").trim();
    if (!normalizedContent || !activeSession.value) return false;
    return (activeSession.value.messages || []).some(
      (messageItem) =>
        String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
        String(messageItem?.content || "").trim() === normalizedContent,
    );
  }

  function applyFoldedMessagesToActiveSession(foldedMessages = []) {
    if (!activeSession.value) return [];
    const existingMessages = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const nextMessages = mergeCurrentUserMessagesIntoFoldedMessages({
      foldedMessages,
      existingMessages,
    }).map(
      (nextMessage) => {
        const reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
        return reusableMessage
          ? patchMessageObjectPreservingUiState(reusableMessage, nextMessage)
          : nextMessage;
      },
    );
    if (activeSession.value.messages !== existingMessages) {
      activeSession.value.messages = existingMessages;
    }
    existingMessages.splice(0, existingMessages.length, ...nextMessages);
    return existingMessages;
  }


  function applyFoldedMessagesForDialogProcess(foldedMessages = [], dialogProcessId = "") {
    if (!activeSession.value) return [];
    const normalizedDpId = String(dialogProcessId || "").trim();
    if (!normalizedDpId) return applyFoldedMessagesToActiveSession(foldedMessages);
    const existingMessages = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const assistantMessagesForDialogProcess = (Array.isArray(foldedMessages) ? foldedMessages : [])
      .filter(
        (messageItem) =>
          String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
          String(messageItem?.dialogProcessId || "").trim() === normalizedDpId,
      );
    if (!assistantMessagesForDialogProcess.length) return existingMessages;

    for (const nextMessage of assistantMessagesForDialogProcess) {
      let reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
      if (!reusableMessage) {
        reusableMessage = findLatestPendingAssistantAfterLastUser(existingMessages);
        if (reusableMessage && String(reusableMessage?.dialogProcessId || "").trim()) {
          reusableMessage = null;
        }
      }
      if (reusableMessage) {
        reusableMessage.dialogProcessId = normalizedDpId;
        patchMessageObjectPreservingUiState(reusableMessage, nextMessage);
        continue;
      }
      existingMessages.push(nextMessage);
    }
    return existingMessages;
  }

  function resolveReconnectTerminalStatusLabel(messages = []) {
    const terminalEnvelope = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((envelope) => isReconnectTerminalEvent(envelope?.event || ""));
    const terminalEventName = String(terminalEnvelope?.event || "").trim();
    if (terminalEventName === StreamEventEnum.STOPPED) return translate("chat.stopped");
    if (terminalEventName === StreamEventEnum.ERROR) return translate("chat.failed");
    return translate("chat.generated");
  }

  function createFinalAssistantFromReconnectReplay(messages = [], dialogProcessId = "") {
    if (!activeSession.value) return null;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const replayText =
      collectReconnectDeltaText(messages) ||
      String(
        [...(Array.isArray(messages) ? messages : [])]
          .reverse()
          .find((envelope) => String(envelope?.event || "").trim() === StreamEventEnum.DONE)
          ?.data?.answer || "",
      );
    if (!String(replayText || "").trim()) return null;

    const existingAssistantMessage = findAssistantMessageByDialogProcessId(normalizedDpId);
    const targetAssistantMessage = existingAssistantMessage ||
      (hasAssistantMessageWithContent(replayText)
        ? null
        : appendMessage(RoleEnum.ASSISTANT, replayText));
    if (!targetAssistantMessage) return null;

    const currentContent = String(targetAssistantMessage?.content || "");
    if (!currentContent.trim()) {
      targetAssistantMessage.content = replayText;
    } else if (!currentContent.includes(replayText) && !replayText.includes(currentContent)) {
      targetAssistantMessage.content = `${currentContent}${replayText}`;
    }

    targetAssistantMessage.pending = false;
    targetAssistantMessage.statusLabel = resolveReconnectTerminalStatusLabel(messages);
    if (normalizedDpId) targetAssistantMessage.dialogProcessId = normalizedDpId;
    const errorEnvelope = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((envelope) => String(envelope?.event || "").trim() === StreamEventEnum.ERROR);
    if (errorEnvelope) {
      targetAssistantMessage.error = String(errorEnvelope?.data?.error || "");
    }
    return targetAssistantMessage;
  }

  function applyDoneMessagesFromReconnect(eventData = {}) {
    if (!activeSession.value) return false;
    const sessionMessages = Array.isArray(eventData?.messages) ? eventData.messages : [];
    if (!sessionMessages.length) return false;
    const returnedSessionId = String(eventData?.sessionId || "").trim();
    if (returnedSessionId) {
      const promotionResult = promoteSessionIdentityToBackendId({
        sessionItem: activeSession.value,
        backendSessionId: returnedSessionId,
        activeSessionId: activeSessionId.value,
      });
      activeSessionId.value = promotionResult.nextActiveSessionId;
    }
    activeSession.value.loaded = true;
    activeSession.value.rawMessages = sessionMessages.map((messageItem) =>
      makeViewMessage(messageItem),
    );
    const foldedSessionMessages = foldMessagesForView(sessionMessages);
    const doneDialogProcessId = String(eventData?.dialogProcessId || "").trim();
    if (doneDialogProcessId && Array.isArray(activeSession.value.messages) && activeSession.value.messages.length) {
      // DONE snapshots may contain the whole conversation. During reconnect we
      // should only finalize the dialog process that emitted DONE; patching the
      // entire folded history can mutate/remount the previous assistant message.
      applyFoldedMessagesForDialogProcess(foldedSessionMessages, doneDialogProcessId);
    } else {
      applyFoldedMessagesToActiveSession(foldedSessionMessages);
    }
    applyCompletedToolLogsToMessages(
      activeSession.value.messages,
      activeSession.value.sessionDocs || [],
    );
    activeSession.value.messageCount = activeSession.value.messages.length;
    activeSession.value.lastMessage = activeSession.value.messages.length
      ? activeSession.value.messages[activeSession.value.messages.length - 1]
      : null;
    activeSession.value.title = sessionTitleFromMessages(
      activeSession.value.messages,
      activeSession.value.title || returnedSessionId.slice(0, 8),
    );
    activeSession.value.updatedAt = new Date().toISOString();
    return true;
  }

  function applyReconnectMessagesToActiveSession(
    messages,
    dialogProcessId,
    { allowCreate = true } = {},
  ) {
    if (!activeSession.value) return;
    const normalizedDpId = String(dialogProcessId || "").trim();
    const lastAppliedSeq = Number(appliedReconnectSeqByDialogProcessId[normalizedDpId] || 0);
    const nextMessages = (Array.isArray(messages) ? messages : []).filter((envelope) => {
      if (isPendingInteractionReplay(envelope)) return true;
      const sequence = getReconnectEnvelopeSequence(envelope);
      return !sequence || sequence > lastAppliedSeq;
    });
    if (!nextMessages.length) return;
    const batchHasTerminalEvent = isReconnectTerminalBatch(nextMessages);
    const shouldCreateTarget = Boolean(allowCreate) && !batchHasTerminalEvent;
    const doneEnvelopeWithMessages = findReconnectDoneEnvelopeWithMessages(nextMessages);
    const maxSequence = getReconnectMaxSequence(nextMessages, lastAppliedSeq);
    if (doneEnvelopeWithMessages) {
      applyDoneMessagesFromReconnect(doneEnvelopeWithMessages.data || {});
      finalizeReconnectTerminalState();
      markReconnectSequenceApplied(normalizedDpId, maxSequence);
      scrollBottom();
      return;
    }

    const targetMessage = resolveReconnectTargetAssistantMessage(normalizedDpId, {
      allowCreate: shouldCreateTarget,
    });
    if (!targetMessage) {
      createFinalAssistantFromReconnectReplay(nextMessages, normalizedDpId);
      if (!shouldCreateTarget) {
        finalizeReconnectTerminalState();
      }
      markReconnectSequenceApplied(normalizedDpId, maxSequence);
      scrollBottom();
      return;
    }
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
      } else if (eventName === StreamEventEnum.INTERACTION_REQUEST) {
        const interactionRequest = normalizeInteractionRequestPayload(eventData);
        if (!isInteractionRequestHandled(interactionRequest)) {
          setPendingInteractionRequest(interactionRequest);
        }
      } else if (eventName === StreamEventEnum.DONE) {
        targetMessage.pending = false;
        targetMessage.statusLabel = translate("chat.generated");
        if (Array.isArray(eventData?.messages) && eventData.messages.length) {
          applyDoneMessagesFromReconnect(eventData);
        }
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
    markReconnectSequenceApplied(normalizedDpId, maxAppliedSeq);
    scrollBottom();
  }

  async function applyReconnectEvent(event, data) {
    const dpId = String(data?.dialogProcessId || "").trim();
    const sessionId = String(data?.sessionId || "").trim();
    const eventName = String(event || "").trim();
    if (sessionId && !isCurrentActiveSession(sessionId) && !isReconnectTerminalEvent(eventName)) {
      const switched = await ensureReconnectSessionActive(sessionId);
      if (switched) {
        sending.value = true;
      }
    }
    if (sessionId && isCurrentActiveSession(sessionId)) {
      applyReconnectMessagesToActiveSession([{ event, data }], dpId);
      return;
    }
    if (sessionId && dpId) {
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
