/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  buildSessionIdentityMap,
  findSessionByAnyId as findSessionByAnyIdInList,
  resolveSessionPrimaryId as resolveSessionPrimaryIdInList,
} from "../../infra/sessionIdentity";
import { parseTimeMs } from "../../infra/timeFields";
import {
  mapSummaryToSession,
  reconcileSessionObject,
  revokeMessagePreviewUrls,
} from "./sessionRecords";

export function createSessionListActions({
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
      preserveCurrentMessages = false,
      requireFresh = false,
      shouldNavigateToLastMessage = options.navigateToLastMessage !== false,
      silent = false,
    } = options;
    if (!sessionId) return;
    const target = findSessionByAnyIdInList(sessions.value, sessionId);
    if (!target) return;
    const targetPrimaryId = String(target.id || sessionId || "").trim();
    if (!force && targetPrimaryId === activeSessionId.value) return;
    activeSessionId.value = targetPrimaryId;
    if (target.isLocal) {
      refreshSessionConnectorsAsync(targetPrimaryId);
      if (shouldNavigateToLastMessage) navigateToLastMessage?.();
      return;
    }
    if (target.loaded && !force) {
      onSessionDetailApplied?.({
        detail: {
          sessionId: target.backendSessionId || target.sessionId || target.id || targetPrimaryId,
          sessions: target.sessionDocs || [],
          source: "selectSession.loadedSnapshot",
        },
        sessionItem: target,
        mainSessionDoc: Array.isArray(target.sessionDocs) ? target.sessionDocs[0] || {} : {},
        normalizedDetailMessages: Array.isArray(target.messages) ? target.messages : [],
        preserveCurrentMessages: true,
      });
      refreshSessionConnectorsAsync(targetPrimaryId);
      if (shouldNavigateToLastMessage) navigateToLastMessage?.();
      return;
    }

    if (!silent) loadingSessionDetail.value = true;
    try {
      const detailSessionId = String(target.backendSessionId || target.id || sessionId || "").trim();
      const detail = await fetchSessionDetail(detailSessionId, {
        source: "selectSession",
        force,
        requireFresh,
        allowLoadedSnapshot: true,
      });
      if (detail) {
        applySessionDetail(detail, {
          preserveCurrentMessages:
            Boolean(preserveCurrentMessages) &&
            Array.isArray(target?.messages) &&
            target.messages.length > 0,
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
      preserveCurrentMessages = true,
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
      const nextSessions = (data.sessions || [])
        .filter((sessionItem) => String(sessionItem?.caller || "") === RoleEnum.USER)
        .sort(
          (leftSession, rightSession) =>
            parseTimeMs(rightSession.updatedAt) -
            parseTimeMs(leftSession.updatedAt),
        )
        .map((sessionItem) => {
          const mappedSession = mapSummaryToSession(sessionItem, { sessionTitleFromMessages, createConnectorPanelState });
          return reconcileSessionObject(
            mappedSession,
            existingSessionsById.get(String(mappedSession.id || "")) || null,
            { sessionTitleFromMessages },
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
          !forceCurrentSessionRerender &&
          Boolean(existingNextSession) &&
          Array.isArray(existingNextSession?.messages) &&
          existingNextSession.messages.length > 0,
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
    if (String(targetSession.title || "").trim() === normalizedTitle) {
      notify({ type: "info", message: translate("common.sessionTitleUnchanged") });
      return false;
    }
    if (targetSession?.isLocal) {
      targetSession.title = normalizedTitle;
      return true;
    }
    if (!ensureConnected()) return false;
    const backendSessionId = String(targetSession.backendSessionId || targetSession.id || targetSessionId).trim();
    const res = await renameSessionApi(
      { userId: userId.value, sessionId: backendSessionId, title: normalizedTitle },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || translate("common.renameSessionFailed"));
    }
    await fetchSessions(targetSessionId, { preserveCurrentMessages: true });
    return true;
  }

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;

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

  return {
    fetchSessions,
    selectSession,
    deleteSession,
    renameSession,
  };
}
