/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../chat/model/chatConstants.js";
import {
  buildSessionIdentityMap,
  findSessionByAnyId as findSessionByAnyIdInList,
  resolveSessionPrimaryId as resolveSessionPrimaryIdInList,
} from "../../../chat/model/sessionIdentity.js";
import { parseTimeMs } from "../../../chat/model/timeFields.js";
import {
  mapSummaryToSession,
  reconcileSessionObject,
  revokeMessagePreviewUrls,
} from "./sessionRecords.js";
import { removeSessionRuntime, sessionRuntimeId } from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { clearSessionTurnUiStates } from "../../../chat/runtime/engine/turnUiStore.js";

export function createSessionListActions({
  sessions,
  activeSessionId,
  loadingSessions,
  loadingSessionDetail,
  turnRuntimeRegistry = null,
  userId,
  authFetch,
  ensureConnected,
  getSessionsApi,
  deleteSessionApi,
  renameSessionApi,
  createConnectorPanelState,
  sessionTitleFromMessages,
  fetchSessionDetail,
  applySessionDetail,
  createLocalSession,
  refreshSessionConnectorsAsync,
  navigateToLastMessage,
  onSessionDetailApplied = null,
  translate,
  notify = () => {},
} = {}) {
  async function selectSession(sessionId, options = {}) {
    const {
      force = false,
      requireFresh = false,
      shouldNavigateToLastMessage = options.navigateToLastMessage !== false,
      silent = false,
    } = options;
    if (!sessionId) return;
    const target = findSessionByAnyIdInList(sessions.value, sessionId);
    if (!target) return;
    const targetPrimaryId = String(target.sessionId || sessionId || "").trim();
    if (!force && targetPrimaryId === activeSessionId.value) return;
    if (target.isUnavailable === true) {
      notify({
        type: "warning",
        message: target.unavailableReason?.message || translate("common.sessionUnavailableLegacyProtocol"),
      });
      return;
    }
    activeSessionId.value = targetPrimaryId;
    if (target.isLocal) {
      refreshSessionConnectorsAsync(targetPrimaryId);
      if (shouldNavigateToLastMessage) navigateToLastMessage?.();
      return;
    }
    if (target.loaded && !force) {
      onSessionDetailApplied?.({
        detail: {
          sessionId: target.sessionId || targetPrimaryId,
          sessions: target.sessionDocs || [],
          source: "selectSession.loadedSnapshot",
        },
        sessionItem: target,
        mainSessionDoc: Array.isArray(target.sessionDocs) ? target.sessionDocs[0] || {} : {},
        normalizedDetailMessages: Array.isArray(target.messages) ? target.messages : [],
      });
      refreshSessionConnectorsAsync(targetPrimaryId);
      if (shouldNavigateToLastMessage) navigateToLastMessage?.();
      return;
    }

    if (!silent) loadingSessionDetail.value = true;
    try {
      const detailSessionId = String(target.sessionId || sessionId || "").trim();
      const detail = await fetchSessionDetail(detailSessionId, {
        source: "selectSession",
        force,
        requireFresh,
        allowLoadedSnapshot: true,
      });
      if (detail) {
        applySessionDetail(detail, {
          navigateToLastMessage: shouldNavigateToLastMessage,
        });
      }
      refreshSessionConnectorsAsync(targetPrimaryId);
    } catch (error) {
      notify({ type: "error", message: error.message || translate("chat.loadSessionDetailFailed") });
    } finally {
      if (!silent) loadingSessionDetail.value = false;
    }
  }

  async function fetchSessions(preferredActiveId = "", options = {}) {
    const {
      silent = false,
      shouldNavigateToLastMessage = options.navigateToLastMessage !== false,
      forceCurrentSessionRerender = false,
    } = options;
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
      const persistedSessionIds = new Set();
      const requestedSessionId = String(preferredActiveId || "").trim();
      let requestedSessionDetail = null;
      const nextSessions = (data.sessions || [])
        .filter((sessionItem) => String(sessionItem?.caller || "") === RoleEnum.USER)
        .sort(
          (leftSession, rightSession) =>
            parseTimeMs(rightSession.updatedAt) -
            parseTimeMs(leftSession.updatedAt),
        )
        .map((sessionItem) => {
          const mappedSession = mapSummaryToSession(sessionItem, { sessionTitleFromMessages, createConnectorPanelState });
          persistedSessionIds.add(mappedSession.sessionId);
          const existing = existingSessionsById.get(mappedSession.sessionId);
          return reconcileSessionObject(
            mappedSession,
            existing,
            { sessionTitleFromMessages },
          );
        });
      nextSessions.push(...sessions.value.filter((session) =>
        session?.isLocal === true && !persistedSessionIds.has(String(session.sessionId || "")),
      ));

      sessions.value.splice(0, sessions.value.length, ...nextSessions);

      for (const session of sessions.value) {
        const existingSession = existingSessionsById.get(String(session?.sessionId || ""));
        if (existingSession && existingSession.messages === session.messages) continue;
        revokeMessagePreviewUrls(session.messages || []);
      }

      if (requestedSessionId && !findSessionByAnyIdInList(nextSessions, requestedSessionId)) {
        requestedSessionDetail = await fetchSessionDetail(requestedSessionId, {
          source: "explicitSessionRoute",
          requireFresh: true,
          requireExists: false,
        });
      }
      if (requestedSessionDetail) {
        const requestedSessionDoc = (Array.isArray(requestedSessionDetail?.sessions)
          ? requestedSessionDetail.sessions
          : []).find((doc) => String(doc?.sessionId || "").trim() === requestedSessionId)
          || requestedSessionDetail?.sessions?.[0]
          || {};
        const resolvedRequestedSessionId = String(
          requestedSessionDetail?.sessionId || requestedSessionId,
        ).trim();
        const requestedSession = mapSummaryToSession({
          ...requestedSessionDoc,
          sessionId: resolvedRequestedSessionId,
          caller: requestedSessionDoc.caller || RoleEnum.USER,
        }, { sessionTitleFromMessages, createConnectorPanelState });
        sessions.value.unshift(requestedSession);
        persistedSessionIds.add(resolvedRequestedSessionId);
      }

      if (!sessions.value.length) {
        createLocalSession();
        return true;
      }
      if (requestedSessionDetail) {
        const resolvedRequestedSessionId = String(
          requestedSessionDetail.sessionId || requestedSessionId,
        ).trim();
        activeSessionId.value = resolvedRequestedSessionId;
        applySessionDetail(requestedSessionDetail, {
          navigateToLastMessage: shouldNavigateToLastMessage,
        });
        refreshSessionConnectorsAsync(resolvedRequestedSessionId);
        return true;
      }
      const keepActive = Boolean(prevActiveId && findSessionByAnyIdInList(sessions.value, prevActiveId));
      const nextId = keepActive ? resolveSessionPrimaryIdInList(sessions.value, prevActiveId) : sessions.value[0].sessionId;
      await selectSession(nextId, {
        force: forceCurrentSessionRerender,
        silent,
        navigateToLastMessage: shouldNavigateToLastMessage,
        requireFresh: forceCurrentSessionRerender,
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

  async function renameSession(sessionId = "", title = "") {
    const targetSessionId = String(sessionId || "").trim();
    const normalizedTitle = String(title || "").trim();
    if (!targetSessionId) return false;
    if (!normalizedTitle) {
      notify({ type: "warning", message: translate("common.sessionTitleRequired") });
      return false;
    }
    const targetSession = findSessionByAnyIdInList(sessions.value, targetSessionId);
    if (!targetSession) return false;
    if (targetSession.isUnavailable === true) {
      notify({ type: "warning", message: translate("common.sessionUnavailableLegacyProtocol") });
      return false;
    }
    if (String(targetSession.title || "").trim() === normalizedTitle) {
      notify({ type: "info", message: translate("common.sessionTitleUnchanged") });
      return false;
    }
    if (targetSession?.isLocal) {
      targetSession.title = normalizedTitle;
      return true;
    }
    if (!ensureConnected()) return false;
    const resolvedSessionId = String(targetSession.sessionId || targetSessionId).trim();
    const res = await renameSessionApi(
      { userId: userId.value, sessionId: resolvedSessionId, title: normalizedTitle },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || translate("common.renameSessionFailed"));
    }
    await fetchSessions(targetSessionId);
    return true;
  }

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;

    const index = sessions.value.findIndex((sessionItem) => sessionItem.sessionId === targetSessionId);
    if (index < 0) return false;
    const targetSession = sessions.value[index];
    const runtimeSessionId = sessionRuntimeId(targetSession);

    if (targetSession?.isLocal) {
      revokeMessagePreviewUrls(targetSession.messages || []);
      sessions.value.splice(index, 1);
      removeSessionRuntime(turnRuntimeRegistry?.value || turnRuntimeRegistry, runtimeSessionId);
      clearSessionTurnUiStates(runtimeSessionId);
      if (!sessions.value.length) {
        createLocalSession();
      } else if (activeSessionId.value === targetSessionId) {
        activeSessionId.value = sessions.value[0].sessionId;
        await selectSession(activeSessionId.value, { force: true });
      }
      return true;
    }

    if (!ensureConnected()) return false;
    const isDeletingActive = activeSessionId.value === targetSessionId;
    const fallbackNextSessionId = isDeletingActive
      ? String(sessions.value[index + 1]?.sessionId || sessions.value[index - 1]?.sessionId || "")
      : String(activeSessionId.value || "");
    const res = await deleteSessionApi(
      { userId: userId.value, sessionId: targetSessionId },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || translate("chat.deleteSessionFailed"));
    }

    removeSessionRuntime(turnRuntimeRegistry?.value || turnRuntimeRegistry, runtimeSessionId);
    clearSessionTurnUiStates(runtimeSessionId);

    await fetchSessions(fallbackNextSessionId);
    return true;
  }

  return {
    fetchSessions,
    selectSession,
    deleteSession,
    renameSession,
  };
}
