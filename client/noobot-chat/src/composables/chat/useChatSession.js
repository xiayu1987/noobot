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

  function isReconnectTerminalEvent(eventName = "") {
    return [
      StreamEventEnum.DONE,
      StreamEventEnum.STOPPED,
      StreamEventEnum.ERROR,
    ].includes(String(eventName || "").trim());
  }



  function isSessionEntryRunning(sessionEntry = {}) {
    return sessionEntry?.hasRunningTask === true;
  }

  function hasPendingInteractionReplayEvents(messages = []) {
    return (Array.isArray(messages) ? messages : []).some((envelope) =>
      isPendingInteractionReplay(envelope),
    );
  }

  function isDialogProcessRecoverable(sessionEntry = {}, messages = []) {
    if (isSessionEntryRunning(sessionEntry)) return true;
    // agent-proxy owns replay/running state. On page refresh, cached replay can
    // contain thinking/delta events from a finished run; do not infer a pending
    // UI from those events, otherwise the thinking panel flickers or gets stuck.
    return hasPendingInteractionReplayEvents(messages);
  }

  function findRecoverableReconnectSessionId(sessionsPayload = []) {
    for (const sessionEntry of Array.isArray(sessionsPayload) ? sessionsPayload : []) {
      const sessionId = String(sessionEntry?.sessionId || "").trim();
      if (!sessionId) continue;
      if (isSessionEntryRunning(sessionEntry)) return sessionId;
      const dialogProcesses = Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : [];
      const hasPendingInteraction = dialogProcesses.some((dialogProcess) =>
        hasPendingInteractionReplayEvents(dialogProcess?.messages || []),
      );
      if (hasPendingInteraction) return sessionId;
    }
    return "";
  }

  async function ensureReconnectSessionActive(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || isCurrentActiveSession(normalizedSessionId)) return true;
    const targetSession = sessions.value.find(
      (sessionItem) =>
        String(sessionItem?.id || "").trim() === normalizedSessionId ||
        String(sessionItem?.backendSessionId || "").trim() === normalizedSessionId,
    );
    if (!targetSession) {
      await chatList.fetchSessions(normalizedSessionId, {
        silent: true,
        preserveCurrentMessages: true,
      });
    }
    const resolvedTargetSession = sessions.value.find(
      (sessionItem) =>
        String(sessionItem?.id || "").trim() === normalizedSessionId ||
        String(sessionItem?.backendSessionId || "").trim() === normalizedSessionId,
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
    const sessions = Array.isArray(reconnectData?.sessions) ? reconnectData.sessions : [];
    const recoverableSessionId = findRecoverableReconnectSessionId(sessions);
    if (recoverableSessionId) {
      await ensureReconnectSessionActive(recoverableSessionId);
      sending.value = true;
      const recoverableSessionEntry = sessions.find(
        (sessionEntry) => String(sessionEntry?.sessionId || "").trim() === recoverableSessionId,
      );
      const recoverableDialogProcesses = Array.isArray(recoverableSessionEntry?.dialogProcesses)
        ? recoverableSessionEntry.dialogProcesses
        : [];
      const hasReconnectMessages = recoverableDialogProcesses.some(
        (dialogProcess) => Array.isArray(dialogProcess?.messages) && dialogProcess.messages.length,
      );
      if (!hasReconnectMessages && isCurrentActiveSession(recoverableSessionId)) {
        resolveReconnectTargetAssistantMessage("", { allowCreate: true });
      }
    }
    for (const sessionEntry of sessions) {
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

  function getLastUserMessageIndex(messages = []) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      if (String(messages[messageIndex]?.role || "").trim() === RoleEnum.USER) {
        return messageIndex;
      }
    }
    return -1;
  }

  function findLatestPendingAssistantAfterLastUser(messages = []) {
    const lastUserMessageIndex = getLastUserMessageIndex(messages);
    for (let messageIndex = messages.length - 1; messageIndex > lastUserMessageIndex; messageIndex -= 1) {
      const messageItem = messages[messageIndex];
      if (String(messageItem?.role || "").trim() !== RoleEnum.ASSISTANT) continue;
      if (!messageItem?.pending) continue;
      return messageItem;
    }
    return null;
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

  function getReconnectEnvelopeSequence(envelope = {}) {
    return Number(envelope?.data?.seq || envelope?.sequence || 0);
  }


  function splitReconnectMessagesByDialogProcessId(messages = [], fallbackDialogProcessId = "") {
    const normalizedFallback = String(fallbackDialogProcessId || "").trim();
    const groups = new Map();
    for (const envelope of Array.isArray(messages) ? messages : []) {
      const envelopeDpId = String(envelope?.data?.dialogProcessId || "").trim();
      const groupKey = envelopeDpId || normalizedFallback || "__unknown__";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(envelope);
    }
    return Array.from(groups.entries()).map(([groupKey, groupMessages]) => ({
      dialogProcessId: groupKey === "__unknown__" ? "" : groupKey,
      messages: groupMessages,
    }));
  }

  function resolveDialogProcessIdFromReplay(messages = [], fallbackDialogProcessId = "") {
    const fallback = String(fallbackDialogProcessId || "").trim();
    if (fallback) return fallback;
    const matchedEnvelope = (Array.isArray(messages) ? messages : []).find((envelope) =>
      String(envelope?.data?.dialogProcessId || "").trim(),
    );
    return String(matchedEnvelope?.data?.dialogProcessId || "").trim();
  }

  function isPendingInteractionReplay(envelope = {}) {
    return (
      String(envelope?.event || "").trim() === StreamEventEnum.INTERACTION_REQUEST &&
      envelope?.data?.__agentProxyPendingInteraction === true
    );
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

  function findReconnectDoneEnvelopeWithMessages(messages = []) {
    return (Array.isArray(messages) ? messages : []).find(
      (envelope) =>
        String(envelope?.event || "").trim() === StreamEventEnum.DONE &&
        Array.isArray(envelope?.data?.messages) &&
        envelope.data.messages.length,
    );
  }

  function getReconnectMaxSequence(messages = [], fallbackSeq = 0) {
    return (Array.isArray(messages) ? messages : []).reduce(
      (maxSeq, envelope) => Math.max(maxSeq, getReconnectEnvelopeSequence(envelope)),
      Number(fallbackSeq || 0),
    );
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

  function collectReconnectDeltaText(messages = []) {
    return (Array.isArray(messages) ? messages : [])
      .filter((envelope) => String(envelope?.event || "").trim() === StreamEventEnum.DELTA)
      .map((envelope) => String(envelope?.data?.text || ""))
      .join("");
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

  function normalizeMessageContentForCompare(content = "") {
    return String(content || "").trim();
  }

  function messageCompareKey(messageItem = {}) {
    const role = String(messageItem?.role || "").trim();
    const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
    const content = normalizeMessageContentForCompare(messageItem?.content || "");
    if (role === RoleEnum.USER) {
      const attachmentKey = (Array.isArray(messageItem?.attachmentMetas)
        ? messageItem.attachmentMetas
        : [])
        .map((attachmentItem) =>
          [attachmentItem?.name, attachmentItem?.attachmentId, attachmentItem?.size]
            .map((item) => String(item || "").trim())
            .join(":"),
        )
        .join(",");
      return `${role}|${content}|${attachmentKey}`;
    }
    return `${role}|${dialogProcessId}|${content}`;
  }

  function parseMessageTimeMs(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return value > 1e11 ? value : value * 1000;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber > 1e11 ? asNumber : asNumber * 1000;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function mergeCurrentUserMessagesIntoFoldedMessages(foldedMessages = []) {
    const outputMessages = Array.isArray(foldedMessages) ? [...foldedMessages] : [];
    const existingMessages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    const existingKeys = new Set(outputMessages.map((messageItem) => messageCompareKey(messageItem)));
    for (const currentMessage of existingMessages) {
      if (String(currentMessage?.role || "").trim() !== RoleEnum.USER) continue;
      const currentKey = messageCompareKey(currentMessage);
      if (existingKeys.has(currentKey)) continue;
      outputMessages.push(currentMessage);
      existingKeys.add(currentKey);
    }
    outputMessages.sort((leftMessage, rightMessage) => {
      const leftTime = parseMessageTimeMs(leftMessage?.ts);
      const rightTime = parseMessageTimeMs(rightMessage?.ts);
      if (leftTime && rightTime && leftTime !== rightTime) return leftTime - rightTime;
      if (String(leftMessage?.role || "") === RoleEnum.USER && String(rightMessage?.role || "") === RoleEnum.ASSISTANT) return -1;
      if (String(leftMessage?.role || "") === RoleEnum.ASSISTANT && String(rightMessage?.role || "") === RoleEnum.USER) return 1;
      return 0;
    });
    return outputMessages;
  }

  function findReusableMessageObject(nextMessage = {}, existingMessages = []) {
    const nextRole = String(nextMessage?.role || "").trim();
    const nextDialogProcessId = String(nextMessage?.dialogProcessId || "").trim();
    if (nextRole === RoleEnum.ASSISTANT && nextDialogProcessId) {
      const byDialogProcessId = existingMessages.find(
        (existingMessage) =>
          String(existingMessage?.role || "").trim() === RoleEnum.ASSISTANT &&
          String(existingMessage?.dialogProcessId || "").trim() === nextDialogProcessId,
      );
      if (byDialogProcessId) return byDialogProcessId;
    }
    const nextKey = messageCompareKey(nextMessage);
    return existingMessages.find(
      (existingMessage) => messageCompareKey(existingMessage) === nextKey,
    ) || null;
  }

  function patchMessageObjectPreservingUiState(targetMessage = {}, sourceMessage = {}) {
    const thinkingOpenNames = Array.isArray(targetMessage?.thinkingOpenNames)
      ? targetMessage.thinkingOpenNames
      : null;
    const expandedDetailLogKeys = Array.isArray(targetMessage?.expandedDetailLogKeys)
      ? targetMessage.expandedDetailLogKeys
      : null;
    const existingContent = String(targetMessage?.content || "");
    const existingAttachmentMetas = Array.isArray(targetMessage?.attachmentMetas)
      ? targetMessage.attachmentMetas
      : [];
    const existingModelRuns = Array.isArray(targetMessage?.modelRuns)
      ? targetMessage.modelRuns
      : [];
    const existingCompletedToolLogs = Array.isArray(targetMessage?.completedToolLogs)
      ? targetMessage.completedToolLogs
      : [];
    const existingRealtimeLogs = Array.isArray(targetMessage?.realtimeLogs)
      ? targetMessage.realtimeLogs
      : [];

    Object.assign(targetMessage, sourceMessage);

    // Replayed/done snapshots can be partial. Never degrade an already rendered
    // previous message with empty fields from a partial backend/replay payload.
    if (existingContent.trim() && !String(sourceMessage?.content || "").trim()) {
      targetMessage.content = existingContent;
    }
    if (existingAttachmentMetas.length && !Array.isArray(sourceMessage?.attachmentMetas)?.length) {
      targetMessage.attachmentMetas = existingAttachmentMetas;
    }
    if (existingModelRuns.length && !Array.isArray(sourceMessage?.modelRuns)?.length) {
      targetMessage.modelRuns = existingModelRuns;
    }
    if (existingCompletedToolLogs.length && !Array.isArray(sourceMessage?.completedToolLogs)?.length) {
      targetMessage.completedToolLogs = existingCompletedToolLogs;
    }
    if (existingRealtimeLogs.length && !Array.isArray(sourceMessage?.realtimeLogs)?.length) {
      targetMessage.realtimeLogs = existingRealtimeLogs;
    }
    if (thinkingOpenNames) targetMessage.thinkingOpenNames = thinkingOpenNames;
    if (expandedDetailLogKeys) targetMessage.expandedDetailLogKeys = expandedDetailLogKeys;
    return targetMessage;
  }

  function applyFoldedMessagesToActiveSession(foldedMessages = []) {
    if (!activeSession.value) return [];
    const existingMessages = Array.isArray(activeSession.value.messages)
      ? activeSession.value.messages
      : [];
    const nextMessages = mergeCurrentUserMessagesIntoFoldedMessages(foldedMessages).map(
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
      const sessionItem = activeSession.value;
      sessionItem.backendSessionId = returnedSessionId;
      sessionItem.isLocal = false;
      if (String(sessionItem.id || "").trim() !== returnedSessionId) {
        sessionItem.id = returnedSessionId;
        activeSessionId.value = returnedSessionId;
      }
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
