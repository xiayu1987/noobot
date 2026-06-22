/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { useLocale } from "../../shared/i18n/useLocale";
import { createSessionDetailApplicator } from "./chatList/sessionDetailApply";
import { createSessionDetailRequests } from "./chatList/sessionDetailRequests";
import { createSessionListActions } from "./chatList/sessionListActions";
import { createSessionIdentityHelpers } from "./chatList/sessionIdentity";
import {
  createLocalSessionItem,
  revokeMessagePreviewUrls,
} from "./chatList/sessionRecords";

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
  getSessionFullDetailApi = null,
  getSessionThinkingDetailApi = null,
  deleteSessionApi,
  makeViewMessage,
  foldMessagesForView,
  scrollBottom,
  refreshSessionConnectorsAsync,
  clearUploads,
  notify = () => {},
  processStore = null,
} = {}) {
  const { translate } = useLocale();
  const { isSameSessionIdentity } = createSessionIdentityHelpers({ sessions });

  function createLocalSession() {
    const id = generateSessionId();
    const newSessionItem = createLocalSessionItem({
      id,
      title: translate("chat.newSession"),
      createConnectorPanelState,
    });
    sessions.value.unshift(newSessionItem);
    activeSessionId.value = id;
  }

  function newSession() {
    if (sending.value) {
      notify({ type: "warning", message: translate("chat.cannotCreateWhileSending") });
      return;
    }
    createLocalSession();
  }

  const { applySessionDetail } = createSessionDetailApplicator({
    sessions,
    activeSessionId,
    makeViewMessage,
    foldMessagesForView,
    sessionTitleFromMessages,
    applyCompletedToolLogsToMessages,
    scrollBottom,
    isSameSessionIdentity,
    processStore,
  });

  const {
    fetchSessionDetail,
    fetchSessionFullDetail,
    fetchThinkingDetail,
  } = createSessionDetailRequests({
    sessions,
    activeSessionId,
    userId,
    authFetch,
    getSessionDetailApi,
    getSessionFullDetailApi,
    getSessionThinkingDetailApi,
    applySessionDetail,
    isSameSessionIdentity,
    translate,
  });

  const {
    fetchSessions,
    selectSession,
    deleteSession,
  } = createSessionListActions({
    sessions,
    activeSessionId,
    loadingSessions,
    loadingSessionDetail,
    sending,
    userId,
    authFetch,
    ensureConnected,
    getSessionsApi,
    deleteSessionApi,
    createConnectorPanelState,
    sessionTitleFromMessages,
    fetchSessionDetail,
    applySessionDetail,
    createLocalSession,
    refreshSessionConnectorsAsync,
    translate,
    notify,
  });

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
    fetchSessionFullDetail,
    fetchThinkingDetail,
    applySessionDetail,
    releaseAllPreviewUrls,
    initSessionsAfterMount,
  };
}
