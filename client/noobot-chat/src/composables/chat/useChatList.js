/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../shared/constants/chatConstants";
import {
  buildSessionIdentityMap,
  findSessionByAnyId as findSessionByAnyIdInList,
  promoteSessionIdentityToBackendId,
  resolveSessionPrimaryId as resolveSessionPrimaryIdInList,
} from "../infra/sessionIdentity";
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
  const RECENT_SESSION_DETAIL_REUSE_MS = 2000;
  let recentSessionDetail = null;
  const pendingSessionDetailRequests = new Map();

  function normalizeSessionId(value = "") {
    return String(value || "").trim();
  }

  function collectSessionIdentityIds(sessionItem = null) {
    return [
      sessionItem?.id,
      sessionItem?.backendSessionId,
      sessionItem?.sessionId,
    ].map(normalizeSessionId).filter(Boolean);
  }

  function isSameSessionIdentity(leftSessionId = "", rightSessionId = "") {
    const leftId = normalizeSessionId(leftSessionId);
    const rightId = normalizeSessionId(rightSessionId);
    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;
    const leftSession = findSessionByAnyIdInList(sessions.value, leftId);
    const rightSession = findSessionByAnyIdInList(sessions.value, rightId);
    if (leftSession && rightSession && leftSession === rightSession) return true;
    const leftIds = collectSessionIdentityIds(leftSession);
    const rightIds = collectSessionIdentityIds(rightSession);
    return leftIds.some((id) => rightIds.includes(id));
  }

  function buildLoadedSessionDetailSnapshot(sessionId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return null;
    const sessionItem = findSessionByAnyIdInList(sessions.value, normalizedSessionId);
    if (!sessionItem?.loaded) return null;
    const sessionDocs = Array.isArray(sessionItem.sessionDocs) ? sessionItem.sessionDocs : [];
    if (!sessionDocs.length) return null;
    const backendSessionId = normalizeSessionId(
      sessionItem.backendSessionId || sessionItem.id || normalizedSessionId,
    );
    return {
      ok: true,
      exists: true,
      sessionId: backendSessionId,
      sessions: sessionDocs,
    };
  }

  function createSessionDetailRequestState(sessionId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const targetSession = findSessionByAnyIdInList(sessions.value, normalizedSessionId);
    const activeId = normalizeSessionId(activeSessionId.value);
    const pendingEntry = pendingSessionDetailRequests.get(normalizedSessionId);
    const recentMatches =
      normalizedSessionId &&
      recentSessionDetail?.sessionId &&
      isSameSessionIdentity(recentSessionDetail.sessionId, normalizedSessionId) &&
      Date.now() - recentSessionDetail.loadedAt <= RECENT_SESSION_DETAIL_REUSE_MS;
    return {
      sessionId: normalizedSessionId,
      activeSessionId: activeId,
      targetSession,
      targetLoaded: targetSession?.loaded === true,
      sameAsActive: isSameSessionIdentity(normalizedSessionId, activeId),
      pendingPromise: pendingEntry?.promise || null,
      recentDetail: recentMatches ? recentSessionDetail.detail : null,
    };
  }

  function arbitrateSessionDetailRequest(sessionId = "", intent = {}) {
    const state = createSessionDetailRequestState(sessionId);
    const source = normalizeSessionId(intent.source || intent.reason || "direct");
    const force = intent.force === true;
    const requireFresh = intent.requireFresh === true;
    const allowLoadedSnapshot = intent.allowLoadedSnapshot === true;
    const reuseRecentlyLoaded = intent.reuseRecentlyLoaded === true;
    if (!state.sessionId) return { action: "skip", state, source };
    if (state.pendingPromise) return { action: "wait", promise: state.pendingPromise, state, source };
    if (!requireFresh && reuseRecentlyLoaded && state.recentDetail) {
      return { action: "reuse", detail: state.recentDetail, state, source };
    }
    if (
      !requireFresh &&
      allowLoadedSnapshot &&
      state.targetLoaded &&
      (!force || state.sameAsActive)
    ) {
      const detail = buildLoadedSessionDetailSnapshot(state.sessionId);
      if (detail) return { action: "reuse", detail, state, source };
    }
    return { action: "fetch", state, source };
  }

  function buildWorkflowMessageSignature(messageItem = {}) {
    const workflowMeta =
      messageItem?.workflowMeta &&
      typeof messageItem.workflowMeta === "object" &&
      !Array.isArray(messageItem.workflowMeta)
        ? messageItem.workflowMeta
        : {};
    const semanticPreview = String(
      workflowMeta?.semanticTextPreview ||
        workflowMeta?.payload?.interaction?.semanticTextPreview ||
        "",
    ).trim();
    return [
      String(messageItem?.dialogProcessId || "").trim(),
      String(messageItem?.content || "").trim(),
      semanticPreview,
    ].join("|");
  }

  function patchExistingWorkflowMessage(existingMessage = null, workflowMessageItem = {}) {
    if (!existingMessage || !workflowMessageItem) return false;
    const thinkingOpenNames = Array.isArray(existingMessage?.thinkingOpenNames)
      ? existingMessage.thinkingOpenNames
      : [];
    Object.assign(existingMessage, workflowMessageItem);
    existingMessage.pending = false;
    existingMessage.workflowMessage = true;
    if (thinkingOpenNames.length) existingMessage.thinkingOpenNames = thinkingOpenNames;
    return true;
  }

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
    const titleFallback = item.sessionId.slice(0, 8);
    const title = String(item.title || "").trim()
      || sessionTitleFromMessages(messages, titleFallback);
    const messageCount = Number.isFinite(Number(item.messageCount))
      ? Number(item.messageCount)
      : messages.length || 0;
    const lastMessage = item.lastMessage && typeof item.lastMessage === "object"
      ? item.lastMessage
      : messages.length
        ? messages[messages.length - 1]
        : null;
    return {
      id: item.sessionId,
      title,
      isLocal: false,
      loaded: false,
      backendSessionId: item.sessionId,
      currentTaskId: item.currentTaskId || "",
      currentTaskStatus: "idle",
      messageCount,
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
    const sessionItem = findSessionByAnyIdInList(sessions.value, detail.sessionId);
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

    const detailSessionId = String(detail.sessionId || "").trim();
    sessionItem.loaded = true;
    const promotionResult = promoteSessionIdentityToBackendId({
      sessionItem,
      backendSessionId: detailSessionId,
      activeSessionId: activeSessionId.value,
    });
    activeSessionId.value = promotionResult.nextActiveSessionId;
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
    if (mainSessionDoc.version !== undefined) sessionItem.version = mainSessionDoc.version;
    if (mainSessionDoc.revision !== undefined) sessionItem.revision = mainSessionDoc.revision;
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
    } else {
      const foldedDetailMessages = foldMessagesForView(mainSessionDoc.messages || []);
      const workflowMessages = foldedDetailMessages.filter(
        (messageItem) =>
          String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
          messageItem?.workflowMessage === true,
      );
      if (workflowMessages.length) {
        const existingMessages = Array.isArray(sessionItem.messages) ? sessionItem.messages : [];
        const existingWorkflowSignatures = new Set(
          existingMessages
            .filter((messageItem) => messageItem?.workflowMessage === true)
            .map((messageItem) => buildWorkflowMessageSignature(messageItem)),
        );
        for (const workflowMessageItem of workflowMessages) {
          const signature = buildWorkflowMessageSignature(workflowMessageItem);
          if (!signature || existingWorkflowSignatures.has(signature)) continue;
          const workflowDialogProcessId = String(
            workflowMessageItem?.dialogProcessId || "",
          ).trim();
          const existingAssistantForDialog = existingMessages.find(
            (messageItem) =>
              String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
              messageItem?.workflowMessage !== true &&
              workflowDialogProcessId &&
              String(messageItem?.dialogProcessId || "").trim() === workflowDialogProcessId,
          );
          if (patchExistingWorkflowMessage(existingAssistantForDialog, workflowMessageItem)) {
            existingWorkflowSignatures.add(signature);
            continue;
          }
          existingMessages.push(workflowMessageItem);
          existingWorkflowSignatures.add(signature);
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

  async function fetchSessionDetail(sessionId, options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const decision = arbitrateSessionDetailRequest(normalizedSessionId || sessionId, options);
    if (decision.action === "skip") return null;
    if (decision.action === "reuse") return decision.detail;
    if (decision.action === "wait") return decision.promise;

    const requestPromise = (async () => {
      const res = await getSessionDetailApi(
        { userId: userId.value, sessionId: normalizedSessionId || sessionId },
        { fetcher: authFetch },
      );
      if (!res.ok) throw new Error(translate("chat.getSessionFailed", { status: res.status }));
      const data = await res.json();
      if (!data.ok || !data.exists) throw new Error(data.error || translate("chat.sessionNotFound"));
      recentSessionDetail = {
        sessionId: normalizeSessionId(data.sessionId || normalizedSessionId || sessionId),
        loadedAt: Date.now(),
        detail: data,
      };
      return data;
    })();

    pendingSessionDetailRequests.set(normalizedSessionId || sessionId, {
      promise: requestPromise,
      source: decision.source,
      startedAt: Date.now(),
    });
    try {
      return await requestPromise;
    } finally {
      pendingSessionDetailRequests.delete(normalizedSessionId || sessionId);
    }
  }

  async function fetchSessions(preferredActiveId = "", options = {}) {
    const { silent = false, preserveCurrentMessages = true } = options;
    if (!ensureConnected()) return false;
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
        return true;
      }
      const keepActive = Boolean(prevActiveId && findSessionByAnyIdInList(sessions.value, prevActiveId));
      const nextId = keepActive ? resolveSessionPrimaryIdInList(sessions.value, prevActiveId) : sessions.value[0].id;
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
      return true;
    } catch (error) {
      notify({ type: "error", message: error.message || translate("chat.loadSessionsFailed") });
      if (!sessions.value.length) createLocalSession();
      return false;
    } finally {
      if (!silent) loadingSessions.value = false;
    }
  }

  async function selectSession(sessionId, options = {}) {
    const { force = false, preserveCurrentMessages = false, silent = false } = options;
    if (!sessionId) return;
    const target = findSessionByAnyIdInList(sessions.value, sessionId);
    if (!target) return;
    const targetPrimaryId = String(target.id || sessionId || "").trim();
    if (!force && targetPrimaryId === activeSessionId.value) return;
    if (sending.value && activeSessionId.value && targetPrimaryId !== activeSessionId.value) {
      // User-triggered switch should be blocked while sending; internal reconnect
      // recovery uses silent mode and must be allowed to avoid replay/session drift.
      if (!silent) {
        notify({ type: "warning", message: translate("chat.keepCurrentWhenSending") });
        return;
      }
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
      const detail = await fetchSessionDetail(detailSessionId, {
        source: "selectSession",
        force,
        allowLoadedSnapshot: true,
      });
      if (detail) {
        applySessionDetail(detail, {
          preserveCurrentMessages:
            Boolean(preserveCurrentMessages) &&
            Array.isArray(target?.messages) &&
            target.messages.length > 0,
        });
      }
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
