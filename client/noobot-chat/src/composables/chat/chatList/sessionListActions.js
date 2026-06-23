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
  createConnectorPanelState,
  sessionTitleFromMessages,
  fetchSessionDetail,
  applySessionDetail,
  createLocalSession,
  refreshSessionConnectorsAsync,
  translate,
  notify = () => {},
} = {}) {
  async function selectSession(sessionId, options = {}) {
    const {
      force = false,
      preserveCurrentMessages = false,
      scrollToBottom = true,
      silent = false,
    } = options;
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
          scrollToBottom,
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
      scrollToBottom = true,
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
          Boolean(existingNextSession) &&
          Array.isArray(existingNextSession?.messages) &&
          existingNextSession.messages.length > 0,
        scrollToBottom,
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

  return {
    fetchSessions,
    selectSession,
    deleteSession,
  };
}
