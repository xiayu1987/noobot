/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
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
  const CONNECTOR_TYPES = ["database", "terminal", "email"];
  const CONNECTOR_TYPE_SET = new Set(CONNECTOR_TYPES);

  function normalizeConnectorType(connectorType = "") {
    return String(connectorType || "").trim();
  }

  function normalizeSelectedConnectors(selectedConnectors = {}) {
    const source =
      selectedConnectors && typeof selectedConnectors === "object"
        ? selectedConnectors
        : {};
    return {
      database: String(source?.database || "").trim(),
      terminal: String(source?.terminal || "").trim(),
      email: String(source?.email || "").trim(),
    };
  }

  function createConnectorPanelState(overrides = {}) {
    const normalizedSelectedConnectors = normalizeSelectedConnectors(
      overrides?.selectedConnectors || {},
    );
    return {
      rootSessionId: String(overrides?.rootSessionId || "").trim(),
      groups: {
        database: Array.isArray(overrides?.groups?.database)
          ? overrides.groups.database
          : [],
        terminal: Array.isArray(overrides?.groups?.terminal)
          ? overrides.groups.terminal
          : [],
        email: Array.isArray(overrides?.groups?.email)
          ? overrides.groups.email
          : [],
      },
      selectedConnectors: normalizedSelectedConnectors,
      updatedAt: new Date().toISOString(),
    };
  }

  const input = ref("");
  const uploadFiles = ref([]);
  const sending = ref(false);
  const sessions = ref([]);
  const activeSessionId = ref("");
  const loadingSessions = ref(false);
  const loadingSessionDetail = ref(false);
  const activeChatSocket = ref(null);
  const stopRequested = ref(false);
  const pendingInteractionRequest = ref(null);
  const interactionSubmitting = ref(false);
  const connectorRefreshTasksBySessionId = new Map();
  let stopCloseTimer = null;
  let forceStopFinalizeTimer = null;
  let resolveCurrentStream = null;

  function markPendingAssistantMessageStopped() {
    const sessionItem = activeSession.value;
    const messageList = Array.isArray(sessionItem?.messages)
      ? sessionItem.messages
      : [];
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (String(messageItem?.role || "") !== "assistant") continue;
      if (!messageItem?.pending) continue;
      messageItem.pending = false;
      messageItem.statusLabel = "已停止";
      if (!String(messageItem.content || "").trim()) {
        messageItem.content = "（已停止）";
      }
      break;
    }
  }

  function forceStopUiFinalize() {
    if (!sending.value) return;
    pendingInteractionRequest.value = null;
    interactionSubmitting.value = false;
    markPendingAssistantMessageStopped();
    sending.value = false;
    if (activeChatSocket.value) {
      try {
        activeChatSocket.value.close(1000, "stop_force_finalize");
      } catch {}
      activeChatSocket.value = null;
    }
    scrollBottom();
  }

  const activeSession = computed(() =>
    sessions.value.find((sessionItem) => sessionItem.id === activeSessionId.value),
  );

  function sessionTitleFromMessages(messages = [], fallback = "新会话") {
    const firstUser = messages.find(
      (messageItem) =>
        messageItem.role === "user" && (messageItem.content || "").trim(),
    );
    return firstUser ? firstUser.content.slice(0, 20) : fallback;
  }

  function generateSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      (placeholder) => {
        const randomValue = Math.floor(Math.random() * 16);
        const resolvedValue =
          placeholder === "x" ? randomValue : (randomValue & 0x3) | 0x8;
        return resolvedValue.toString(16);
      },
    );
  }

  function createLocalSession() {
    const id = generateSessionId();
    const newSessionItem = {
      id,
      title: "新会话",
      isLocal: true,
      loaded: true,
      backendSessionId: id,
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 0,
      lastMessage: null,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: createConnectorPanelState(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.value.unshift(newSessionItem);
    activeSessionId.value = id;
  }

  function newSession() {
    if (sending.value) {
      ElMessage.warning("发送中，暂不能新建会话");
      return;
    }
    createLocalSession();
  }

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;
    if (sending.value) {
      ElMessage.warning("发送中，暂不能删除会话");
      return false;
    }

    const index = sessions.value.findIndex(
      (sessionItem) => sessionItem.id === targetSessionId,
    );
    if (index < 0) return false;
    const targetSession = sessions.value[index];

    if (targetSession?.isLocal) {
      revokeMessagePreviewUrls(targetSession.messages || []);
      sessions.value.splice(index, 1);
      if (!sessions.value.length) {
        createLocalSession();
      } else if (activeSessionId.value === targetSessionId) {
        activeSessionId.value = sessions.value[0].id;
        await selectSession(activeSessionId.value, { force: true });
      }
      return true;
    }

    if (!ensureConnected()) return false;
    const isDeletingActive = activeSessionId.value === targetSessionId;
    const fallbackNextSessionId = isDeletingActive
      ? String(
          sessions.value[index + 1]?.id ||
            sessions.value[index - 1]?.id ||
            "",
        )
      : String(activeSessionId.value || "");
    const res = await deleteSessionApi(
      { userId: userId.value, sessionId: targetSessionId },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "删除会话失败");
    }
    await fetchSessions(fallbackNextSessionId);
    return true;
  }

  function mapSummaryToSession(item) {
    const messages = Array.isArray(item.messages) ? item.messages : [];
    const lastMessage = messages.length ? messages[messages.length - 1] : null;
    return {
      id: item.sessionId,
      title: sessionTitleFromMessages(messages, item.sessionId.slice(0, 8)),
      isLocal: false,
      loaded: false,
      backendSessionId: item.sessionId,
      currentTaskId: item.currentTaskId || "",
      currentTaskStatus: "idle",
      messageCount: messages.length || 0,
      lastMessage,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: createConnectorPanelState(),
      createdAt: item.createdAt || "",
      updatedAt: item.updatedAt || "",
      caller: item.caller || "",
      depth: Number(item.depth || 0),
    };
  }

  function revokeMessagePreviewUrls(messages = []) {
    for (const messageItem of messages) {
      const attachmentMetas = messageItem.attachmentMetas || [];
      for (const attachmentItem of attachmentMetas) {
        if (attachmentItem.previewUrl)
          URL.revokeObjectURL(attachmentItem.previewUrl);
      }
    }
  }

  async function fetchSessions(preferredActiveId = "") {
    if (!ensureConnected()) return;
    loadingSessions.value = true;
    try {
      const prevActiveId = String(preferredActiveId || activeSessionId.value || "");
      const res = await getSessionsApi(
        { userId: userId.value },
        { fetcher: authFetch },
      );
      if (!res.ok) throw new Error(`获取 sessions 失败: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "获取 sessions 失败");

      sessions.value = (data.sessions || [])
        .filter((sessionItem) => String(sessionItem?.caller || "") === "user")
        .sort(
          (leftSession, rightSession) =>
            new Date(rightSession.updatedAt || 0).getTime() -
            new Date(leftSession.updatedAt || 0).getTime(),
        )
        .map(mapSummaryToSession);

      for (const session of sessions.value) {
        revokeMessagePreviewUrls(session.messages || []);
      }

      if (!sessions.value.length) {
        createLocalSession();
        return;
      }
      const keepActive =
        prevActiveId &&
        sessions.value.some((sessionItem) => sessionItem.id === prevActiveId);
      const nextId = keepActive ? prevActiveId : sessions.value[0].id;
      await selectSession(nextId, { force: true });
    } catch (error) {
      ElMessage.error(error.message || "加载会话失败");
      if (!sessions.value.length) createLocalSession();
    } finally {
      loadingSessions.value = false;
    }
  }

  function onUploadChange(file, fileList) {
    uploadFiles.value = fileList
      .map((fileItem) => fileItem.raw)
      .filter(Boolean)
      .map((raw) => ({
        raw,
        name: raw.name,
        mimeType: raw.type || "application/octet-stream",
        size: raw.size || 0,
        previewUrl: isImageMime(raw.type || "") ? URL.createObjectURL(raw) : "",
      }));
  }

  function clearUploads() {
    for (const uploadFile of uploadFiles.value) {
      if (uploadFile.previewUrl) URL.revokeObjectURL(uploadFile.previewUrl);
    }
    uploadFiles.value = [];
    clearUploadSelection();
  }

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

  function pickAssistantMessagesForCurrentTurn({
    foldedMessages = [],
    dialogProcessId = "",
  }) {
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
    const messageList = Array.isArray(foldedMessages) ? foldedMessages : [];
    const lastUserMessageIndex = (() => {
      for (
        let messageIndex = messageList.length - 1;
        messageIndex >= 0;
        messageIndex -= 1
      ) {
        if (String(messageList[messageIndex]?.role || "") === "user") {
          return messageIndex;
        }
      }
      return -1;
    })();
    const assistantMessagesAfterLastUser = messageList.filter(
      (messageItem, messageIndex) =>
        messageIndex > lastUserMessageIndex &&
        String(messageItem?.role || "") === "assistant",
    );
    if (!assistantMessagesAfterLastUser.length) return [];
    if (!normalizedDialogProcessId) return assistantMessagesAfterLastUser;
    const matchedMessages = assistantMessagesAfterLastUser.filter(
      (messageItem) =>
        String(messageItem?.dialogProcessId || "").trim() ===
        normalizedDialogProcessId,
    );
    return matchedMessages.length
      ? matchedMessages
      : assistantMessagesAfterLastUser;
  }

  function mergeAssistantContents(assistantMessages = []) {
    const contentList = [];
    for (const assistantMessage of assistantMessages) {
      const content = String(assistantMessage?.content || "").trim();
      if (!content) continue;
      if (contentList[contentList.length - 1] === content) continue;
      contentList.push(content);
    }
    return contentList.join("\n\n");
  }

  function markAssistantMessageStopped(botMessage) {
    botMessage.pending = false;
    botMessage.statusLabel = "已停止";
    pendingInteractionRequest.value = null;
    interactionSubmitting.value = false;
    if (!String(botMessage.content || "").trim()) {
      botMessage.content = "（已停止）";
    }
  }

  function applySessionDetail(detail, options = {}) {
    const preserveCurrentMessages = Boolean(options.preserveCurrentMessages);
    const sessionItem = sessions.value.find(
      (candidateSession) => candidateSession.id === detail.sessionId,
    );
    if (!sessionItem) return;
    const openThinkingDialogProcessIds = new Set(
      (sessionItem.messages || [])
        .filter(
          (messageItem) =>
            String(messageItem?.role || "") === "assistant" &&
            Array.isArray(messageItem?.thinkingOpenNames) &&
            messageItem.thinkingOpenNames.includes("thinking-panel") &&
            String(messageItem?.dialogProcessId || "").trim(),
        )
        .map((messageItem) => String(messageItem.dialogProcessId || "").trim()),
    );
    if (!preserveCurrentMessages) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }
    sessionItem.loaded = true;
    sessionItem.isLocal = false;
    sessionItem.backendSessionId = detail.sessionId;
    const sessionDocs = Array.isArray(detail.sessions) ? detail.sessions : [];
    sessionItem.sessionDocs = sessionDocs;
    const mainSessionDoc =
      sessionDocs.find((doc) => doc.sessionId === detail.sessionId) ||
      sessionDocs[0] ||
      {};
    sessionItem.rawMessages = (mainSessionDoc.messages || []).map((messageItem) =>
      makeViewMessage(messageItem),
    );
    sessionItem.currentTaskId = mainSessionDoc.currentTaskId || "";
    sessionItem.currentTaskStatus = "idle";
    sessionItem.createdAt = mainSessionDoc.createdAt || sessionItem.createdAt;
    sessionItem.updatedAt = mainSessionDoc.updatedAt || sessionItem.updatedAt;
    if (!preserveCurrentMessages) {
      sessionItem.messages = foldMessagesForView(mainSessionDoc.messages || []);
      for (const messageItem of sessionItem.messages || []) {
        const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
        if (!dialogProcessId) continue;
        if (openThinkingDialogProcessIds.has(dialogProcessId)) {
          messageItem.thinkingOpenNames = ["thinking-panel"];
        }
      }
    }
    applyCompletedToolLogsToMessages(sessionItem.messages, sessionDocs);
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = sessionItem.messages.length
      ? sessionItem.messages[sessionItem.messages.length - 1]
      : null;
    if (!preserveCurrentMessages) {
      sessionItem.title = sessionTitleFromMessages(
        sessionItem.messages,
        sessionItem.title || detail.sessionId.slice(0, 8),
      );
      scrollBottom();
    }
  }

  function normalizeConnectorGroupItems(groupItems = []) {
    return (Array.isArray(groupItems) ? groupItems : []).map((connectorItem) => ({
      connectorName: String(
        connectorItem?.connector_name || connectorItem?.connectorName || "",
      ).trim(),
      connectorType: String(
        connectorItem?.connector_type || connectorItem?.connectorType || "",
      ).trim(),
      status: String(connectorItem?.status || "unknown").trim(),
      statusCode: Number(connectorItem?.status_code ?? 0),
      statusMessage: String(connectorItem?.status_message || "").trim(),
      checkedAt: String(connectorItem?.checked_at || "").trim(),
      connectionMeta:
        connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
          ? connectorItem.connection_meta
          : connectorItem?.connectionMeta && typeof connectorItem.connectionMeta === "object"
            ? connectorItem.connectionMeta
            : {},
    }));
  }

  function pickDefaultConnectorName(groupItems = []) {
    const sourceItems = Array.isArray(groupItems) ? groupItems : [];
    if (!sourceItems.length) return "";
    const parseTime = (connectorItem = {}) => {
      const checkedTime = new Date(
        String(
          connectorItem?.checkedAt ||
            connectorItem?.checked_at ||
            connectorItem?.connectedAt ||
            connectorItem?.connected_at ||
            0,
        ),
      ).getTime();
      return Number.isFinite(checkedTime) ? checkedTime : 0;
    };
    const connectedItems = sourceItems.filter(
      (connectorItem) =>
        String(connectorItem?.status || "").trim().toLowerCase() === "connected",
    );
    const sortByRecent = (leftConnector, rightConnector) =>
      parseTime(rightConnector) - parseTime(leftConnector);
    const latestConnectedItem = connectedItems.sort(sortByRecent)[0] || null;
    const latestItem = [...sourceItems].sort(sortByRecent)[0] || null;
    const targetItem = latestConnectedItem || latestItem;
    return String(targetItem?.connectorName || "").trim();
  }

  function resolveSelectedConnectorsWithDefaults({
    groups = {},
    selectedConnectors = {},
  } = {}) {
    const normalizedGroups =
      groups && typeof groups === "object" ? groups : {};
    const selectedSource =
      selectedConnectors && typeof selectedConnectors === "object"
        ? selectedConnectors
        : {};
    const output = normalizeSelectedConnectors({});
    for (const connectorType of CONNECTOR_TYPES) {
      const groupItems = Array.isArray(normalizedGroups?.[connectorType])
        ? normalizedGroups[connectorType]
        : [];
      const selectedConnectorName = String(
        selectedSource?.[connectorType] || "",
      ).trim();
      output[connectorType] = selectedConnectorName || pickDefaultConnectorName(groupItems);
    }
    return output;
  }

  function applySessionConnectorPayload(sessionItem, payload = {}) {
    if (!sessionItem) return;
    const currentSelectedConnectors = normalizeSelectedConnectors(
      sessionItem?.connectorPanelState?.selectedConnectors || {},
    );
    const selectedSource =
      payload?.selectedConnectors && typeof payload.selectedConnectors === "object"
        ? payload.selectedConnectors
        : payload?.selected_connectors && typeof payload.selected_connectors === "object"
          ? payload.selected_connectors
          : {};
    const nextGroups = {
      database: normalizeConnectorGroupItems(
        payload?.connectors?.databases || payload?.groups?.database || [],
      ),
      terminal: normalizeConnectorGroupItems(
        payload?.connectors?.terminals || payload?.groups?.terminal || [],
      ),
      email: normalizeConnectorGroupItems(
        payload?.connectors?.emails || payload?.groups?.email || [],
      ),
    };
    const nextSelectedConnectors = resolveSelectedConnectorsWithDefaults({
      groups: nextGroups,
      selectedConnectors: {
        ...currentSelectedConnectors,
        ...normalizeSelectedConnectors(selectedSource),
      },
    });
    sessionItem.connectorPanelState = createConnectorPanelState({
      rootSessionId:
        payload?.rootSessionId || payload?.root_session_id || payload?.sessionId || "",
      groups: nextGroups,
      selectedConnectors: nextSelectedConnectors,
    });
  }

  function upsertConnectedConnectorInPanelState(
    sessionItem,
    {
      connectorType = "",
      connectorName = "",
      status = "connected",
    } = {},
  ) {
    if (!sessionItem) return;
    const normalizedConnectorType = String(connectorType || "").trim();
    const normalizedConnectorName = String(connectorName || "").trim();
    if (
      !CONNECTOR_TYPE_SET.has(normalizedConnectorType) ||
      !normalizedConnectorName
    ) {
      return;
    }
    const panelState =
      sessionItem.connectorPanelState &&
      typeof sessionItem.connectorPanelState === "object"
        ? sessionItem.connectorPanelState
        : createConnectorPanelState();
    const groupItems = Array.isArray(panelState?.groups?.[normalizedConnectorType])
      ? [...panelState.groups[normalizedConnectorType]]
      : [];
    const hitIndex = groupItems.findIndex(
      (connectorItem) =>
        String(connectorItem?.connectorName || "").trim() ===
        normalizedConnectorName,
    );
    const connectorStatus = String(status || "connected").trim() || "connected";
    const nextConnectorItem = {
      connectorName: normalizedConnectorName,
      connectorType: normalizedConnectorType,
      status: connectorStatus,
      statusCode: connectorStatus === "connected" ? 0 : 1,
      statusMessage: connectorStatus,
      checkedAt: new Date().toISOString(),
      connectionMeta: {},
    };
    if (hitIndex >= 0) {
      groupItems[hitIndex] = {
        ...groupItems[hitIndex],
        ...nextConnectorItem,
      };
    } else {
      groupItems.push(nextConnectorItem);
    }
    const selectedConnectors = normalizeSelectedConnectors(
      panelState?.selectedConnectors || {},
    );
    const nextSelectedConnectors = {
      ...selectedConnectors,
      [normalizedConnectorType]: normalizedConnectorName,
    };
    sessionItem.connectorPanelState = createConnectorPanelState({
      ...panelState,
      groups: {
        database: Array.isArray(panelState?.groups?.database)
          ? panelState.groups.database
          : [],
        terminal: Array.isArray(panelState?.groups?.terminal)
          ? panelState.groups.terminal
          : [],
        email: Array.isArray(panelState?.groups?.email)
          ? panelState.groups.email
          : [],
        [normalizedConnectorType]: groupItems,
      },
      selectedConnectors: nextSelectedConnectors,
    });
  }

  async function refreshSessionConnectors(sessionId = "") {
    if (!ensureConnected()) return;
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;
    const sessionItem = sessions.value.find(
      (candidateSessionItem) => String(candidateSessionItem?.id || "").trim() === normalizedSessionId,
    );
    if (!sessionItem) {
      return;
    }
    try {
      const response = await getSessionConnectorsApi(
        {
          userId: userId.value,
          sessionId:
            sessionItem.backendSessionId || sessionItem.id || normalizedSessionId,
        },
        { fetcher: authFetch },
      );
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "获取连接器状态失败");
      }
      applySessionConnectorPayload(sessionItem, payload);
    } catch (error) {
      console.warn("refresh session connectors failed", error);
      sessionItem.connectorPanelState = createConnectorPanelState(
        sessionItem.connectorPanelState || {},
      );
    }
  }

  function refreshSessionConnectorsAsync(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return Promise.resolve();
    const pendingTask = connectorRefreshTasksBySessionId.get(normalizedSessionId);
    if (pendingTask) return pendingTask;
    const taskPromise = (async () => {
      try {
        await refreshSessionConnectors(normalizedSessionId);
      } finally {
        connectorRefreshTasksBySessionId.delete(normalizedSessionId);
      }
    })();
    connectorRefreshTasksBySessionId.set(normalizedSessionId, taskPromise);
    return taskPromise;
  }

  async function updateSessionSelectedConnector({
    connectorType = "",
    connectorName = "",
  } = {}) {
    if (!activeSession.value) return false;
    const sessionItem = activeSession.value;
    const normalizedType = normalizeConnectorType(connectorType);
    if (!CONNECTOR_TYPE_SET.has(normalizedType)) return false;
    const normalizedName = String(connectorName || "").trim();
    const currentSelectedConnectors = normalizeSelectedConnectors(
      sessionItem.connectorPanelState?.selectedConnectors || {},
    );
    const nextSelectedConnectors = {
      ...currentSelectedConnectors,
      [normalizedType]: normalizedName,
    };
    sessionItem.connectorPanelState = createConnectorPanelState({
      ...(sessionItem.connectorPanelState || {}),
      selectedConnectors: normalizeSelectedConnectors(nextSelectedConnectors),
    });
    return true;
  }

  async function fetchSessionDetail(sessionId) {
    const res = await getSessionDetailApi(
      { userId: userId.value, sessionId },
      { fetcher: authFetch },
    );
    if (!res.ok) throw new Error(`获取 session 失败: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !data.exists) throw new Error(data.error || "session 不存在");
    return data;
  }

  async function selectSession(sessionId, options = {}) {
    const { force = false } = options;
    if (!sessionId) return;
    const target = sessions.value.find(
      (sessionItem) => sessionItem.id === sessionId,
    );
    if (!target) return;
    if (!force && sessionId === activeSessionId.value) return;
    if (sending.value && activeSessionId.value && sessionId !== activeSessionId.value) {
      ElMessage.warning("消息发送中，已保持当前会话，聊天不中断");
      return;
    }
    activeSessionId.value = sessionId;
    if (target.isLocal) {
      refreshSessionConnectorsAsync(sessionId);
      return;
    }
    if (target.loaded && !force) {
      refreshSessionConnectorsAsync(sessionId);
      return;
    }

    loadingSessionDetail.value = true;
    try {
      const detail = await fetchSessionDetail(sessionId);
      applySessionDetail(detail);
      refreshSessionConnectorsAsync(sessionId);
    } catch (error) {
      ElMessage.error(error.message || "加载会话详情失败");
    } finally {
      loadingSessionDetail.value = false;
    }
  }

  async function streamChat(payload, onEvent) {
    await new Promise((resolve, reject) => {
      const wsUrl = buildChatWebSocketUrl({ apiKey: apiKey.value || "" });
      const ws = new WebSocket(wsUrl);
      activeChatSocket.value = ws;
      stopRequested.value = false;
      let settled = false;
      let doneReceived = false;

      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        if (stopCloseTimer) {
          clearTimeout(stopCloseTimer);
          stopCloseTimer = null;
        }
        if (forceStopFinalizeTimer) {
          clearTimeout(forceStopFinalizeTimer);
          forceStopFinalizeTimer = null;
        }
        resolveCurrentStream = null;
        if (activeChatSocket.value === ws) {
          activeChatSocket.value = null;
        }
        fn();
      };
      resolveCurrentStream = () => finalize(() => resolve());

      ws.onopen = () => {
        ws.send(JSON.stringify(payload || {}));
      };

      ws.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const evt = {
            event: String(parsed?.event || "message"),
            data: parsed?.data || {},
          };
          if (evt.event === "error") {
            throw new Error(evt.data?.error || "websocket stream error");
          }
          onEvent(evt);
          if (evt.event === "done") {
            doneReceived = true;
            ws.close(1000, "done");
          } else if (evt.event === "stopped") {
            doneReceived = true;
            ws.close(1000, "stopped");
          }
        } catch (error) {
          ws.close(1011, "invalid_event");
          finalize(() => reject(error));
        }
      };

      ws.onerror = () => {
        finalize(() => reject(new Error("WebSocket 连接失败")));
      };

      ws.onclose = () => {
        if (doneReceived || stopRequested.value) {
          finalize(() => resolve());
          return;
        }
        finalize(() => reject(new Error("WebSocket 连接已关闭")));
      };
    });
  }

  function stopSending() {
    if (!sending.value) return false;
    stopRequested.value = true;
    const ws = activeChatSocket.value;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: "stop" }));
      } catch {}
      if (stopCloseTimer) clearTimeout(stopCloseTimer);
      stopCloseTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "stop_requested");
        }
      }, 300);
      if (forceStopFinalizeTimer) clearTimeout(forceStopFinalizeTimer);
      forceStopFinalizeTimer = setTimeout(() => {
        const latestSocket = activeChatSocket.value;
        if (
          latestSocket &&
          (latestSocket.readyState === WebSocket.OPEN ||
            latestSocket.readyState === WebSocket.CONNECTING)
        ) {
          latestSocket.close(1000, "stop_force_finalize");
        }
        const resolveStream = resolveCurrentStream;
        if (typeof resolveStream === "function") {
          resolveStream();
        }
        forceStopUiFinalize();
      }, 5000);
      return true;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "stop_requested");
      if (forceStopFinalizeTimer) clearTimeout(forceStopFinalizeTimer);
      forceStopFinalizeTimer = setTimeout(() => {
        const resolveStream = resolveCurrentStream;
        if (typeof resolveStream === "function") {
          resolveStream();
        }
        forceStopUiFinalize();
      }, 5000);
      return true;
    }
    if (stopRequested.value) {
      forceStopUiFinalize();
      return true;
    }
    return false;
  }

  function submitInteractionResponse(response = {}, requestOverride = null) {
    const request =
      requestOverride && typeof requestOverride === "object"
        ? requestOverride
        : pendingInteractionRequest.value;
    const ws = activeChatSocket.value;
    if (!request?.requestId || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("交互通道不可用");
    }
    interactionSubmitting.value = true;
    const requireEncryption = request?.requireEncryption === true;
    const sessionId = String(request?.sessionId || "").trim();
    const responsePayload =
      requireEncryption && sessionId
        ? {
            encrypted: true,
            payload: encryptPayloadBySessionId(response || {}, sessionId),
          }
        : response || {};
    ws.send(
      JSON.stringify({
        action: "interaction_response",
        requestId: request.requestId,
        response: responsePayload,
      }),
    );
    if (!requestOverride) {
      pendingInteractionRequest.value = null;
    }
    interactionSubmitting.value = false;
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function serializeAttachments(files) {
    const out = [];
    for (const fileItem of files) {
      out.push({
        name: fileItem.name,
        mimeType: fileItem.mimeType || "application/octet-stream",
        contentBase64: await toBase64(fileItem.raw),
      });
    }
    return out;
  }

  async function send() {
    if (!ensureConnected()) return;
    if (sending.value || !activeSession.value) return;
    if (!input.value.trim() && uploadFiles.value.length === 0) return;

    sending.value = true;
    const text = input.value.trim();
    input.value = "";

    const filesToSend = [...uploadFiles.value];
    const userAttachments = filesToSend.map((fileItem) => ({
      name: fileItem.name,
      mimeType: fileItem.mimeType,
      size: fileItem.size,
      previewUrl: isImageMime(fileItem.mimeType || "")
        ? URL.createObjectURL(fileItem.raw)
        : "",
    }));
    appendMessage("user", text || "[仅上传附件]", userAttachments);
    if (activeSession.value.title === "新会话" && text) {
      activeSession.value.title = text.slice(0, 20);
    }

    const botMsg = appendMessage("assistant", "");
    botMsg.pending = true;
    botMsg.statusLabel = "";
    scrollBottom();

    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;

      const payload = {
        userId: userId.value,
        sessionId: activeSession.value.backendSessionId || activeSession.value.id,
        message: text || "请先读取我上传的附件并总结关键信息。",
        attachments,
        config: {
          allowUserInteraction:
            allowUserInteraction?.value === false ? false : true,
          selectedConnectors: normalizeSelectedConnectors(
            activeSession.value?.connectorPanelState?.selectedConnectors || {},
          ),
        },
      };

      await streamChat(payload, ({ event, data }) => {
        if (event === "thinking") {
          const item = classifyRealtimeLog(data);
          if (!item.subAgentCall && item.dialogProcessId) {
            botMsg.dialogProcessId = item.dialogProcessId;
          }
          botMsg.realtimeLogs = [...(botMsg.realtimeLogs || []), item].slice(-10);
        } else if (event === "delta") {
          const chunkText = String(data.text || "");
          botMsg.content += chunkText;
          if (chunkText) {
            scrollBottom();
          }
        } else if (event === "interaction_request") {
          const interactionType = String(data?.interactionType || "").trim();
          if (interactionType === "connector_connected") {
            const interactionData =
              data?.interactionData && typeof data.interactionData === "object"
                ? data.interactionData
                : {};
            const connectedType = String(
              data?.connectorType || interactionData?.connectorType || "",
            ).trim();
            const connectedName = String(
              data?.connectorName || interactionData?.connectorName || "",
            ).trim();
            const connectedStatus = String(
              interactionData?.status || "connected",
            ).trim();
            if (
              CONNECTOR_TYPE_SET.has(connectedType) &&
              connectedName
            ) {
              upsertConnectedConnectorInPanelState(activeSession.value, {
                connectorType: connectedType,
                connectorName: connectedName,
                status: connectedStatus,
              });
              refreshSessionConnectorsAsync(activeSession.value.id);
            }
            try {
              submitInteractionResponse({
                confirmed: true,
                response: "connector_connected_ack",
              }, {
                requestId: String(data?.requestId || ""),
                requireEncryption: data?.requireEncryption === true,
                sessionId: String(data?.sessionId || ""),
              });
            } catch {}
            return;
          }
          pendingInteractionRequest.value = {
            requestId: String(data?.requestId || ""),
            content: String(data?.content || ""),
            fields: Array.isArray(data?.fields) ? data.fields : [],
            dialogProcessId: String(data?.dialogProcessId || ""),
            requireEncryption: data?.requireEncryption === true,
            sessionId: String(data?.sessionId || ""),
            toolName: String(data?.toolName || ""),
            needConnectionInfo: data?.needConnectionInfo === true,
            connectorName: String(data?.connectorName || ""),
            connectorType: String(data?.connectorType || ""),
            interactionType,
            interactionData:
              data?.interactionData && typeof data.interactionData === "object"
                ? data.interactionData
                : {},
          };
        } else if (event === "done") {
          pendingInteractionRequest.value = null;
          finalDoneEventData = data || {};
          botMsg.pending = false;
          botMsg.statusLabel = "生成完成";
          botMsg.dialogProcessId =
            data.dialogProcessId || botMsg.dialogProcessId || "";
          const returnedId = data.sessionId || activeSession.value.backendSessionId;
          if (activeSession.value.isLocal && returnedId) {
            activeSession.value.backendSessionId = returnedId;
            activeSession.value.isLocal = false;
            activeSession.value.loaded = true;
          }
          if (Array.isArray(data.messages) && data.messages.length) {
            activeSession.value.rawMessages = data.messages.map((messageItem) =>
              makeViewMessage(messageItem),
            );
            const folded = foldMessagesForView(data.messages);
            const assistantMessagesForCurrentTurn =
              pickAssistantMessagesForCurrentTurn({
                foldedMessages: folded,
                dialogProcessId: botMsg.dialogProcessId || data.dialogProcessId,
              });
            const lastAssistant =
              assistantMessagesForCurrentTurn[assistantMessagesForCurrentTurn.length - 1];
            if (lastAssistant) {
              const mergedAssistantContent = mergeAssistantContents(
                assistantMessagesForCurrentTurn,
              );
              const lastAssistantType = String(lastAssistant.type || "");
              if (lastAssistantType && lastAssistantType !== "tool_call") {
                botMsg.type = lastAssistantType;
              }
              botMsg.tool_calls = Array.isArray(lastAssistant.tool_calls)
                ? lastAssistant.tool_calls
                : [];
              botMsg.dialogProcessId =
                lastAssistant.dialogProcessId || botMsg.dialogProcessId;
              botMsg.content = String(mergedAssistantContent || botMsg.content || "");
              botMsg.modelAlias = String(lastAssistant.modelAlias || "").trim();
              botMsg.modelName = String(lastAssistant.modelName || "").trim();
              if (Array.isArray(lastAssistant.modelRuns)) {
                botMsg.modelRuns = lastAssistant.modelRuns;
              }
              if (Array.isArray(lastAssistant.attachmentMetas)) {
                botMsg.attachmentMetas = lastAssistant.attachmentMetas;
              }
            }
          }
          scrollBottom();
        } else if (event === "stopped") {
          markAssistantMessageStopped(botMsg);
          scrollBottom();
        }
      });
      if (stopRequested.value) {
        markAssistantMessageStopped(botMsg);
        scrollBottom();
        return;
      }

      const doneSessionId = String(
        finalDoneEventData?.sessionId || activeSession.value.backendSessionId || "",
      );
      if (doneSessionId) {
        try {
          const detail = await fetchSessionDetail(doneSessionId);
          const shouldPreserveCurrentMessages =
            String(doneSessionId || "") ===
              String(activeSession.value?.backendSessionId || "") &&
            String(activeSession.value?.id || "") ===
              String(activeSessionId.value || "");
          applySessionDetail(detail, {
            preserveCurrentMessages: shouldPreserveCurrentMessages,
          });
          refreshSessionConnectorsAsync(
            activeSession.value?.id || doneSessionId,
          );
        } catch (loadDetailError) {
          console.warn("load session detail after done failed", loadDetailError);
        }
      }
    } catch (error) {
      botMsg.pending = false;
      if (stopRequested.value) {
        pendingInteractionRequest.value = null;
        interactionSubmitting.value = false;
        botMsg.statusLabel = "已停止";
        if (!String(botMsg.content || "").trim()) {
          botMsg.content = "（已停止）";
        }
        return;
      }
      pendingInteractionRequest.value = null;
      botMsg.statusLabel = "生成失败";
      const errorMessage = error.message || "未知错误";
      botMsg.error = errorMessage;
      if (!botMsg.content?.trim()) {
        botMsg.content = `> 发生错误：${botMsg.error}`;
      } else {
        botMsg.content += `\n\n> 发生错误：${botMsg.error}`;
      }
      ElMessage.error(error.message);
    } finally {
      sending.value = false;
      stopRequested.value = false;
      if (!pendingInteractionRequest.value) {
        interactionSubmitting.value = false;
      }
    }
  }

  function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
    if (isMobileRef.value) mobileSidebarOpenRef.value = false;
  }

  function shouldRenderMessageInChat(messageItem) {
    const messageRole = String(messageItem?.role || "");
    if (messageRole === "tool") {
      return false;
    }
    return true;
  }

  function releaseAllPreviewUrls() {
    clearUploads();
    for (const sessionItem of sessions.value) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }
  }

  function initSessionsAfterMount() {
    if (connected.value) {
      fetchSessions();
    } else {
      createLocalSession();
    }
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
    newSession,
    deleteSession,
    fetchSessions,
    selectSession,
    send,
    stopSending,
    refreshSessionConnectors,
    refreshSessionConnectorsAsync,
    updateSessionSelectedConnector,
    pendingInteractionRequest,
    interactionSubmitting,
    submitInteractionResponse,
    onUploadChange,
    clearUploads,
    shouldRenderMessageInChat,
    closeMobileSidebarOnSelect,
    releaseAllPreviewUrls,
    initSessionsAfterMount,
  };
}
