/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../shared/constants/chatConstants";
import { useLocale } from "../../shared/i18n/useLocale";
import {
  buildDialogProcessParentMap,
  flattenSessionMessages,
  mergeAttachmentMetas,
  resolveRootDialogProcessIdByChain,
} from "../infra/dialogProcessChain";

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
  notify = () => {},
} = {}) {
  const { t } = useLocale();
  function buildChildAttachmentMetasByParentDialogProcessId(
    sessionDocs = [],
    rootSessionId = "",
    rootMessages = [],
  ) {
    const output = new Map();
    const rootDialogProcessIdSet = new Set(
      (Array.isArray(rootMessages) ? rootMessages : [])
        .filter((messageItem) => String(messageItem?.role || "") === RoleEnum.ASSISTANT)
        .map((messageItem) => String(messageItem?.dialogProcessId || "").trim())
        .filter(Boolean),
    );
    if (!rootDialogProcessIdSet.size) return output;
    const parentByDialogProcessId = buildDialogProcessParentMap(
      flattenSessionMessages(sessionDocs),
    );
    for (const sessionDoc of Array.isArray(sessionDocs) ? sessionDocs : []) {
      const sessionId = String(sessionDoc?.sessionId || "").trim();
      if (!sessionId || sessionId === String(rootSessionId || "").trim()) continue;
      const messageList = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
      for (const messageItem of messageList) {
        const attachmentMetas = Array.isArray(messageItem?.attachmentMetas)
          ? messageItem.attachmentMetas
          : [];
        if (!attachmentMetas.length) continue;
        const parentDialogProcessId = String(
          messageItem?.parentDialogProcessId || "",
        ).trim();
        if (!parentDialogProcessId) continue;
        const rootDialogProcessId = resolveRootDialogProcessIdByChain({
          startDialogProcessId: parentDialogProcessId,
          rootDialogProcessIdSet,
          parentByDialogProcessId,
        });
        if (!rootDialogProcessId) continue;
        const normalizedAttachmentMetas =
          makeViewMessage({ attachmentMetas }).attachmentMetas || [];
        const mergedAttachmentMetas = mergeAttachmentMetas(
          output.get(rootDialogProcessId) || [],
          normalizedAttachmentMetas,
        );
        output.set(rootDialogProcessId, mergedAttachmentMetas);
      }
    }
    return output;
  }

  function mergeChildTurnAttachmentsIntoRootMessages({
    rootMessages = [],
    sessionDocs = [],
    rootSessionId = "",
  } = {}) {
    const messages = Array.isArray(rootMessages) ? rootMessages : [];
    if (!messages.length) return messages;
    const childAttachmentMetasByParentDialogProcessId =
      buildChildAttachmentMetasByParentDialogProcessId(
        sessionDocs,
        rootSessionId,
        messages,
      );
    if (!childAttachmentMetasByParentDialogProcessId.size) return messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const messageItem = messages[index];
      if (String(messageItem?.role || "") !== RoleEnum.ASSISTANT) continue;
      const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
      if (!dialogProcessId) continue;
      const childAttachmentMetas =
        childAttachmentMetasByParentDialogProcessId.get(dialogProcessId) || [];
      if (!childAttachmentMetas.length) continue;
      messageItem.attachmentMetas = mergeAttachmentMetas(
        messageItem?.attachmentMetas || [],
        childAttachmentMetas,
      );
    }
    return messages;
  }

  function createLocalSession() {
    const id = generateSessionId();
    const newSessionItem = {
      id,
      title: t("chat.newSession"),
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
      notify({ type: "warning", message: t("chat.cannotCreateWhileSending") });
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
      mergeChildTurnAttachmentsIntoRootMessages({
        rootMessages: sessionItem.messages,
        sessionDocs,
        rootSessionId: detail.sessionId,
      });
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
    if (!res.ok) throw new Error(t("chat.getSessionFailed", { status: res.status }));
    const data = await res.json();
    if (!data.ok || !data.exists) throw new Error(data.error || t("chat.sessionNotFound"));
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
      if (!res.ok) throw new Error(t("chat.getSessionsHttpFailed", { status: res.status }));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("chat.getSessionsFailed"));

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
      notify({ type: "error", message: error.message || t("chat.loadSessionsFailed") });
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
      notify({ type: "warning", message: t("chat.keepCurrentWhenSending") });
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
      notify({ type: "error", message: error.message || t("chat.loadSessionDetailFailed") });
    } finally {
      loadingSessionDetail.value = false;
    }
  }

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;
    if (sending.value) {
      notify({ type: "warning", message: t("chat.cannotDeleteWhileSending") });
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
      throw new Error(data.error || t("chat.deleteSessionFailed"));
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
