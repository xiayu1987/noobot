/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  buildSessionIdentityMap,
  findSessionByAnyId as findSessionByAnyIdInList,
  resolveSessionPrimaryId as resolveSessionPrimaryIdInList,
} from "../../../chat/model/sessionIdentity.js";
import {
  mapDetailEntryToSession,
  mapSummaryEntryToSession,
  reconcileSessionObject,
  requireLoadedSessionDetail,
  revokeMessagePreviewUrls,
} from "./sessionRecords.js";
import {
  removeSessionRuntime,
  sessionRuntimeId,
} from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { clearSessionTurnUiStates } from "../../../chat/runtime/engine/turnUiStore.js";
import { requireFunctionDependencies, text } from "@noobot/shared/value";
import { isApiRequestError, readApiResponseEnvelope } from "@noobot/shared/request-error";
import {
  SESSION_SUMMARY_AVAILABILITY,
  compareSessionSummaries,
  requireSessionsSummaryPayload,
} from "@noobot/session-protocol/sessions-summary";
import { selectMainSessionDetailEntry } from "@noobot/session-protocol/session-detail";

export function createSessionListActions({
  sessions,
  activeSessionId,
  loadingSessions,
  loadingSessionDetail,
  turnRuntimeRegistry,
  userId,
  authFetch,
  ensureConnected,
  getSessionsApi,
  deleteSessionApi,
  renameSessionApi,
  createConnectorPanelState,
  fetchSessionDetail,
  applySessionDetail,
  createLocalSession,
  refreshSessionConnectorsAsync,
  onSessionDetailApplied,
  translate,
  notify,
}) {
  requireFunctionDependencies("createSessionListActions", {
    ensureConnected,
    getSessionsApi,
    deleteSessionApi,
    renameSessionApi,
    createConnectorPanelState,
    fetchSessionDetail,
    applySessionDetail,
    createLocalSession,
    refreshSessionConnectorsAsync,
    onSessionDetailApplied,
    translate,
    notify,
  });

  async function selectSession(sessionId, options = {}) {
    const { force = false, requireFresh = false, silent = false } = options;
    if (!sessionId) return;
    const target = findSessionByAnyIdInList(sessions.value, sessionId);
    if (!target) return;
    const targetPrimaryId = target.sessionId;
    if (!force && targetPrimaryId === activeSessionId.value) return;
    if (target.isUnavailable === true) {
      notify({ type: "warning", message: target.unavailableReason.message });
      return;
    }
    activeSessionId.value = targetPrimaryId;
    if (target.isLocal) {
      refreshSessionConnectorsAsync(targetPrimaryId);
      return;
    }
    if (target.loaded && !force) {
      const detail = requireLoadedSessionDetail(target);
      onSessionDetailApplied({
        detail,
        sessionItem: target,
        mainSessionDoc: selectMainSessionDetailEntry(detail),
        normalizedDetailMessages: target.messages,
      });
      refreshSessionConnectorsAsync(targetPrimaryId);
      return;
    }

    if (!silent) loadingSessionDetail.value = true;
    let detail;
    try {
      detail = await fetchSessionDetail(targetPrimaryId, {
        source: "selectSession",
        force,
        requireFresh,
        allowLoadedSnapshot: true,
      });
    } catch (error) {
      if (!isApiRequestError(error)) throw error;
      notify({ type: "error", message: error.message });
      return;
    } finally {
      if (!silent) loadingSessionDetail.value = false;
    }
    if (!detail.exists) {
      notify({ type: "error", message: translate("chat.sessionNotFound") });
      return;
    }
    applySessionDetail(detail);
    refreshSessionConnectorsAsync(targetPrimaryId);
  }

  function reportSessionListRequestFailure(error) {
    notify({ type: "error", message: error.message });
    if (!sessions.value.length) createLocalSession();
    return false;
  }

  async function requestSessionListData() {
    try {
      return {
        status: "loaded",
        data: requireSessionsSummaryPayload(
          await readApiResponseEnvelope(
            await getSessionsApi({ userId: userId.value }, { fetcher: authFetch }),
          ),
        ),
      };
    } catch (error) {
      if (!isApiRequestError(error)) throw error;
      return { status: "failed", failure: reportSessionListRequestFailure(error) };
    }
  }

  function buildNextSessionList({ data, existingSessionsById }) {
    const persistedSessionIds = new Set();
    const nextSessions = data.sessions
      .filter((sessionItem) => sessionItem.caller === SESSION_CALLER.USER)
      .sort(compareSessionSummaries)
      .map((sessionItem) => {
        const mappedSession = mapSummaryEntryToSession(sessionItem, { createConnectorPanelState });
        persistedSessionIds.add(mappedSession.sessionId);
        return reconcileSessionObject(
          mappedSession,
          existingSessionsById.get(mappedSession.sessionId),
        );
      });
    const retainedLocalSessions = sessions.value.filter(
      (session) => session.isLocal === true && !persistedSessionIds.has(session.sessionId),
    );
    return { nextSessions: [...nextSessions, ...retainedLocalSessions], persistedSessionIds };
  }

  function revokeReplacedSessionPreviews(existingSessionsById) {
    for (const session of sessions.value) {
      const existingSession = existingSessionsById.get(session.sessionId);
      if (existingSession && existingSession.messages === session.messages) continue;
      revokeMessagePreviewUrls(session.messages);
    }
  }

  async function resolveRequestedSessionDetail(requestedSessionId, nextSessions) {
    if (!requestedSessionId || findSessionByAnyIdInList(nextSessions, requestedSessionId)) {
      return { status: "skipped" };
    }
    let detail;
    try {
      detail = await fetchSessionDetail(requestedSessionId, {
        source: "explicitSessionRoute",
        requireFresh: true,
      });
    } catch (error) {
      if (!isApiRequestError(error)) throw error;
      return { status: "failed", failure: reportSessionListRequestFailure(error) };
    }
    if (!detail.exists) {
      return { status: "missing" };
    }
    return {
      status: "loaded",
      detail,
      resolvedSessionId: detail.sessionId,
      requestedSessionDoc: selectMainSessionDetailEntry(detail),
    };
  }

  function resolveInitialSessionId(data, nextSessions) {
    const runningSummary = data.sessions
      .filter(
        (summary) =>
          summary.caller === SESSION_CALLER.USER &&
          summary.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE &&
          summary.activeTurnScopeId !== "",
      )
      .sort(compareSessionSummaries)[0];
    return runningSummary === undefined ? nextSessions[0].sessionId : runningSummary.sessionId;
  }

  function insertRequestedSession(requestedSessionDoc, persistedSessionIds) {
    const requestedSession = mapDetailEntryToSession(requestedSessionDoc, {
      createConnectorPanelState,
    });
    sessions.value.unshift(requestedSession);
    persistedSessionIds.add(requestedSession.sessionId);
  }

  async function loadSessionList(preferredActiveId, { silent, forceCurrentSessionRerender }) {
    const prevActiveId = String(preferredActiveId || activeSessionId.value || "");
    const requestedSessionId = text(preferredActiveId);

    const listResult = await requestSessionListData();
    if (listResult.status === "failed") return listResult.failure;

    const existingSessionsById = buildSessionIdentityMap(sessions.value);
    const { nextSessions, persistedSessionIds } = buildNextSessionList({
      data: listResult.data,
      existingSessionsById,
    });
    sessions.value.splice(0, sessions.value.length, ...nextSessions);
    revokeReplacedSessionPreviews(existingSessionsById);

    const requestedResult = await resolveRequestedSessionDetail(requestedSessionId, nextSessions);
    if (requestedResult.status === "failed") return requestedResult.failure;

    if (requestedResult.status === "loaded") {
      insertRequestedSession(requestedResult.requestedSessionDoc, persistedSessionIds);
    }
    if (!sessions.value.length) {
      createLocalSession();
      return true;
    }
    if (requestedResult.status === "loaded") {
      activeSessionId.value = requestedResult.resolvedSessionId;
      applySessionDetail(requestedResult.detail);
      refreshSessionConnectorsAsync(requestedResult.resolvedSessionId);
      return true;
    }

    const retainedPrimaryId = findSessionByAnyIdInList(sessions.value, prevActiveId)
      ? resolveSessionPrimaryIdInList(sessions.value, prevActiveId)
      : "";
    await selectSession(
      retainedPrimaryId || resolveInitialSessionId(listResult.data, nextSessions),
      {
        force: forceCurrentSessionRerender,
        silent,
        requireFresh: forceCurrentSessionRerender,
      },
    );
    return true;
  }

  async function fetchSessions(preferredActiveId = "", options = {}) {
    const { silent = false, forceCurrentSessionRerender = false } = options;
    if (!ensureConnected()) return false;
    if (!silent) loadingSessions.value = true;
    try {
      return await loadSessionList(preferredActiveId, {
        silent,
        forceCurrentSessionRerender,
      });
    } finally {
      if (!silent) loadingSessions.value = false;
    }
  }

  async function renameSession(sessionId = "", title = "") {
    const targetSessionId = text(sessionId);
    const normalizedTitle = text(title);
    if (!targetSessionId) return false;
    if (!normalizedTitle) {
      notify({ type: "warning", message: translate("common.sessionTitleRequired") });
      return false;
    }
    const targetSession = findSessionByAnyIdInList(sessions.value, targetSessionId);
    if (!targetSession) return false;
    if (targetSession.isUnavailable === true) {
      notify({ type: "warning", message: targetSession.unavailableReason.message });
      return false;
    }
    if (text(targetSession.title) === normalizedTitle) {
      notify({ type: "info", message: translate("common.sessionTitleUnchanged") });
      return false;
    }
    if (targetSession?.isLocal) {
      targetSession.title = normalizedTitle;
      return true;
    }
    if (!ensureConnected()) return false;
    const resolvedSessionId = String(targetSession.sessionId || targetSessionId).trim();
    await readApiResponseEnvelope(
      await renameSessionApi(
        { userId: userId.value, sessionId: resolvedSessionId, title: normalizedTitle },
        { fetcher: authFetch },
      ),
    );
    await fetchSessions(targetSessionId);
    return true;
  }

  async function deleteSession(sessionIds) {
    if (!Array.isArray(sessionIds)) {
      throw new TypeError("delete_session_ids_array_required");
    }
    const targetSessionIds = new Set(sessionIds.map((sessionId) => text(sessionId)));
    const targetSessions = sessions.value.filter((sessionItem) =>
      targetSessionIds.has(sessionItem.sessionId),
    );
    if (!targetSessions.length) return false;

    const remoteSessionIds = targetSessions
      .filter((sessionItem) => sessionItem.isLocal !== true)
      .map((sessionItem) => sessionItem.sessionId);
    if (remoteSessionIds.length) {
      if (!ensureConnected()) return false;
      await readApiResponseEnvelope(
        await deleteSessionApi(
          { userId: userId.value, sessionIds: remoteSessionIds },
          { fetcher: authFetch },
        ),
      );
    }

    for (const targetSession of targetSessions) {
      if (targetSession.isLocal === true) revokeMessagePreviewUrls(targetSession.messages || []);
      const runtimeSessionId = sessionRuntimeId(targetSession);
      removeSessionRuntime(turnRuntimeRegistry.value, runtimeSessionId);
      clearSessionTurnUiStates(runtimeSessionId);
    }
    const isDeletingActive = targetSessionIds.has(activeSessionId.value);
    const remainingSessions = sessions.value.filter(
      (sessionItem) => !targetSessionIds.has(sessionItem.sessionId),
    );
    sessions.value.splice(0, sessions.value.length, ...remainingSessions);

    if (remoteSessionIds.length) {
      await fetchSessions(
        isDeletingActive ? text(remainingSessions[0]?.sessionId) : activeSessionId.value,
      );
      return true;
    }
    if (!sessions.value.length) {
      createLocalSession();
    } else if (isDeletingActive) {
      await selectSession(sessions.value[0].sessionId, { force: true });
    }
    return true;
  }

  return {
    fetchSessions,
    selectSession,
    deleteSession,
    renameSession,
  };
}
