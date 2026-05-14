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
  const { translate } = useLocale();
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
      title: translate("chat.newSession"),
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
      notify({ type: "warning", message: translate("chat.cannotCreateWhileSending") });
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

  function buildSessionIdentityMap(sessionItems = []) {
    const output = new Map();
    for (const sessionItem of Array.isArray(sessionItems) ? sessionItems : []) {
      const ids = [sessionItem?.id, sessionItem?.backendSessionId]
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      for (const id of ids) output.set(id, sessionItem);
    }
    return output;
  }

  function findSessionByAnyId(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return null;
    return (sessions.value || []).find(
      (sessionItem) =>
        String(sessionItem?.id || "").trim() === normalizedSessionId ||
        String(sessionItem?.backendSessionId || "").trim() === normalizedSessionId,
    ) || null;
  }

  function resolveSessionPrimaryId(sessionId = "") {
    const targetSession = findSessionByAnyId(sessionId);
    return String(targetSession?.id || sessionId || "").trim();
  }

  function mergeExistingSessionState(mappedSession = {}, existingSession = null) {
    if (!existingSession) return mappedSession;
    const existingMessages = Array.isArray(existingSession?.messages)
      ? existingSession.messages
      : [];
    const existingRawMessages = Array.isArray(existingSession?.rawMessages)
      ? existingSession.rawMessages
      : [];
    const existingSessionDocs = Array.isArray(existingSession?.sessionDocs)
      ? existingSession.sessionDocs
      : [];
    return {
      ...mappedSession,
      loaded: existingSession.loaded === true || mappedSession.loaded === true,
      // A server summary means this is no longer a purely local draft. Do not
      // keep isLocal=true from the optimistic object, otherwise later refreshes
      // treat the backend session as local and skip detail/replay reconciliation.
      isLocal: mappedSession.isLocal === false ? false : existingSession.isLocal === true,
      backendSessionId: mappedSession.backendSessionId || existingSession.backendSessionId,
      currentTaskId: mappedSession.currentTaskId || existingSession.currentTaskId || "",
      currentTaskStatus: mappedSession.currentTaskStatus || existingSession.currentTaskStatus || "idle",
      messages: existingMessages.length ? existingMessages : mappedSession.messages,
      rawMessages: existingRawMessages.length ? existingRawMessages : mappedSession.rawMessages,
      sessionDocs: existingSessionDocs.length ? existingSessionDocs : mappedSession.sessionDocs,
      connectorPanelState: existingSession.connectorPanelState || mappedSession.connectorPanelState,
      messageCount: existingMessages.length || mappedSession.messageCount || 0,
      lastMessage: existingMessages.length
        ? existingMessages[existingMessages.length - 1]
        : mappedSession.lastMessage,
      title: existingMessages.length
        ? sessionTitleFromMessages(existingMessages, existingSession.title || mappedSession.title)
        : mappedSession.title,
    };
  }

  function reconcileSessionObject(mappedSession = {}, existingSession = null) {
    const mergedSession = mergeExistingSessionState(mappedSession, existingSession);
    if (!existingSession) return mergedSession;
    // Keep the same object reference for activeSession and child props.
    // Replacing the object during replay/background refresh remounts large parts
    // of the chat UI and looks like the whole page refreshed.
    Object.assign(existingSession, mergedSession);
    return existingSession;
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
    const sessionItem = findSessionByAnyId(detail.sessionId);
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

    const previousSessionId = String(sessionItem.id || "").trim();
    const detailSessionId = String(detail.sessionId || "").trim();
    const wasActive = [previousSessionId, sessionItem.backendSessionId]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .includes(String(activeSessionId.value || "").trim());

    sessionItem.loaded = true;
    sessionItem.isLocal = false;
    sessionItem.backendSessionId = detailSessionId;
    if (detailSessionId && previousSessionId !== detailSessionId) {
      sessionItem.id = detailSessionId;
      if (wasActive) activeSessionId.value = detailSessionId;
    }
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
    if (!res.ok) throw new Error(translate("chat.getSessionFailed", { status: res.status }));
    const data = await res.json();
    if (!data.ok || !data.exists) throw new Error(data.error || translate("chat.sessionNotFound"));
    return data;
  }

  async function fetchSessions(preferredActiveId = "", options = {}) {
    const { silent = false, preserveCurrentMessages = true } = options;
    if (!ensureConnected()) return;
    if (!silent) loadingSessions.value = true;
    try {
      const prevActiveId = String(preferredActiveId || activeSessionId.value || "");
      const res = await getSessionsApi(
        { userId: userId.value },
        { fetcher: authFetch },
      );
      if (!res.ok) throw new Error(translate("chat.getSessionsHttpFailed", { status: res.status }));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || translate("chat.getSessionsFailed"));

      const existingSessionsById = buildSessionIdentityMap(sessions.value);
      const nextSessions = (data.sessions || [])
        .filter((sessionItem) => String(sessionItem?.caller || "") === RoleEnum.USER)
        .sort(
          (leftSession, rightSession) =>
            new Date(rightSession.updatedAt || 0).getTime() -
            new Date(leftSession.updatedAt || 0).getTime(),
        )
        .map((sessionItem) => {
          const mappedSession = mapSummaryToSession(sessionItem);
          return reconcileSessionObject(
            mappedSession,
            existingSessionsById.get(String(mappedSession.id || "")) || null,
          );
        });

      // Keep the sessions array reference stable. Replacing the whole array
      // during reconnect/background refresh can make the app shell feel like it
      // refreshed. Splice updates the list in place while preserving existing
      // session object references from reconcileSessionObject().
      sessions.value.splice(0, sessions.value.length, ...nextSessions);

      for (const session of sessions.value) {
        const existingSession = existingSessionsById.get(String(session?.id || ""));
        if (existingSession && existingSession.messages === session.messages) continue;
        revokeMessagePreviewUrls(session.messages || []);
      }

      if (!sessions.value.length) {
        createLocalSession();
        return;
      }
      const keepActive = Boolean(prevActiveId && findSessionByAnyId(prevActiveId));
      const nextId = keepActive ? resolveSessionPrimaryId(prevActiveId) : sessions.value[0].id;
      const existingNextSession = existingSessionsById.get(String(prevActiveId || "")) || existingSessionsById.get(String(nextId || ""));
      await selectSession(nextId, {
        force: true,
        silent,
        preserveCurrentMessages:
          preserveCurrentMessages &&
          Boolean(existingNextSession) &&
          Array.isArray(existingNextSession?.messages) &&
          existingNextSession.messages.length > 0,
      });
    } catch (error) {
      notify({ type: "error", message: error.message || translate("chat.loadSessionsFailed") });
      if (!sessions.value.length) createLocalSession();
    } finally {
      if (!silent) loadingSessions.value = false;
    }
  }

  async function selectSession(sessionId, options = {}) {
    const { force = false, preserveCurrentMessages = false, silent = false } = options;
    if (!sessionId) return;
    const target = findSessionByAnyId(sessionId);
    if (!target) return;
    const targetPrimaryId = String(target.id || sessionId || "").trim();
    if (!force && targetPrimaryId === activeSessionId.value) return;
    if (sending.value && activeSessionId.value && targetPrimaryId !== activeSessionId.value) {
      notify({ type: "warning", message: translate("chat.keepCurrentWhenSending") });
      return;
    }

    activeSessionId.value = targetPrimaryId;
    if (target.isLocal) {
      refreshSessionConnectorsAsync(targetPrimaryId);
      return;
    }
    if (target.loaded && !force) {
      refreshSessionConnectorsAsync(targetPrimaryId);
      return;
    }

    if (!silent) loadingSessionDetail.value = true;
    try {
      const detailSessionId = String(target.backendSessionId || target.id || sessionId || "").trim();
      const detail = await fetchSessionDetail(detailSessionId);
      applySessionDetail(detail, {
        preserveCurrentMessages:
          Boolean(preserveCurrentMessages) &&
          Array.isArray(target?.messages) &&
          target.messages.length > 0,
      });
      refreshSessionConnectorsAsync(targetPrimaryId);
    } catch (error) {
      notify({ type: "error", message: error.message || translate("chat.loadSessionDetailFailed") });
    } finally {
      if (!silent) loadingSessionDetail.value = false;
    }
  }

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;
    if (sending.value) {
      notify({ type: "warning", message: translate("chat.cannotDeleteWhileSending") });
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
      throw new Error(data.error || translate("chat.deleteSessionFailed"));
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
