/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage } from "element-plus";
import { RoleEnum } from "../constants/chatConstants";

export function useChatList({
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
  refreshSessionConnectorsAsync,
  clearUploads,
} = {}) {
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
        if (attachmentItem.previewUrl) URL.revokeObjectURL(attachmentItem.previewUrl);
      }
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
            String(messageItem?.role || "") === RoleEnum.ASSISTANT &&
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
        .filter((sessionItem) => String(sessionItem?.caller || "") === RoleEnum.USER)
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

  async function selectSession(sessionId, options = {}) {
    const { force = false } = options;
    if (!sessionId) return;
    const target = sessions.value.find((sessionItem) => sessionItem.id === sessionId);
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

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;
    if (sending.value) {
      ElMessage.warning("发送中，暂不能删除会话");
      return false;
    }

    const index = sessions.value.findIndex((sessionItem) => sessionItem.id === targetSessionId);
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
      ? String(sessions.value[index + 1]?.id || sessions.value[index - 1]?.id || "")
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
    createLocalSession,
    newSession,
    deleteSession,
    fetchSessions,
    selectSession,
    fetchSessionDetail,
    applySessionDetail,
    releaseAllPreviewUrls,
    initSessionsAfterMount,
  };
}
