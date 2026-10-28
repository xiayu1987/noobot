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
import {
  removeSessionRuntime,
  sessionRuntimeId,
} from "../../../chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { clearSessionTurnUiStates } from "../../../chat/runtime/engine/turnUiStore.js";
import { requireFunctionDependencies, text } from "@noobot/shared/value";
import { isApiRequestError, readApiResponseEnvelope } from "@noobot/shared/request-error";

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
  sessionTitleFromMessages,
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
    sessionTitleFromMessages,
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
    const targetPrimaryId = text(target.sessionId || sessionId);
    if (!force && targetPrimaryId === activeSessionId.value) return;
    if (target.isUnavailable === true) {
      notify({
        type: "warning",
        message:
          target.unavailableReason?.message || translate("common.sessionUnavailableLegacyProtocol"),
      });
      return;
    }
    activeSessionId.value = targetPrimaryId;
    if (target.isLocal) {
      refreshSessionConnectorsAsync(targetPrimaryId);
      return;
    }
    if (target.loaded && !force) {
      onSessionDetailApplied({
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
      return;
    }

    if (!silent) loadingSessionDetail.value = true;
    let detail;
    try {
      detail = await fetchSessionDetail(text(target.sessionId || sessionId), {
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
    if (detail) {
      applySessionDetail(detail);
    }
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
        data: await readApiResponseEnvelope(
          await getSessionsApi({ userId: userId.value }, { fetcher: authFetch }),
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
      .filter((sessionItem) => sessionItem.caller === RoleEnum.USER)
      .sort(
        (leftSession, rightSession) =>
          parseTimeMs(rightSession.updatedAt) - parseTimeMs(leftSession.updatedAt),
      )
      .map((sessionItem) => {
        const mappedSession = mapSummaryToSession(sessionItem, {
          sessionTitleFromMessages,
          createConnectorPanelState,
        });
        persistedSessionIds.add(mappedSession.sessionId);
        return reconcileSessionObject(
          mappedSession,
          existingSessionsById.get(mappedSession.sessionId),
          {
            sessionTitleFromMessages,
          },
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
        requireExists: false,
      });
    } catch (error) {
      if (!isApiRequestError(error)) throw error;
      return { status: "failed", failure: reportSessionListRequestFailure(error) };
    }
    if (!detail) {
      return { status: "missing" };
    }
    const resolvedSessionId = text(detail.sessionId) || requestedSessionId;
    const requestedSessionDoc = detail.sessions.find(
      (doc) => text(doc.sessionId) === resolvedSessionId,
    );
    if (!requestedSessionDoc) {
      throw new TypeError("requested_session_document_missing");
    }
    return { status: "loaded", detail, resolvedSessionId, requestedSessionDoc };
  }

  function requireActiveTurnScopeId(summary) {
    if (typeof summary.activeTurnScopeId !== "string") {
      throw new TypeError("session_summary_active_turn_scope_id_required");
    }
    return summary.activeTurnScopeId;
  }

  function resolveInitialSessionId(data, nextSessions) {
    const runningSummary = data.sessions
      .filter((summary) => summary.caller === RoleEnum.USER && requireActiveTurnScopeId(summary))
      .sort((left, right) => parseTimeMs(right.updatedAt) - parseTimeMs(left.updatedAt))[0];
    return runningSummary === undefined ? nextSessions[0].sessionId : runningSummary.sessionId;
  }

  function insertRequestedSession(requestedSessionDoc, persistedSessionIds) {
    const requestedSession = mapSummaryToSession(requestedSessionDoc, {
      sessionTitleFromMessages,
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
      notify({ type: "warning", message: translate("common.sessionUnavailableLegacyProtocol") });
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

  async function deleteSession(sessionId = "") {
    const targetSessionId = text(sessionId);
    if (!targetSessionId) return false;

    const index = sessions.value.findIndex(
      (sessionItem) => sessionItem.sessionId === targetSessionId,
    );
    if (index < 0) return false;
    const targetSession = sessions.value[index];
    const runtimeSessionId = sessionRuntimeId(targetSession);

    if (targetSession?.isLocal) {
      revokeMessagePreviewUrls(targetSession.messages || []);
      sessions.value.splice(index, 1);
      removeSessionRuntime(turnRuntimeRegistry.value, runtimeSessionId);
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
    await readApiResponseEnvelope(
      await deleteSessionApi(
        { userId: userId.value, sessionId: targetSessionId },
        { fetcher: authFetch },
      ),
    );

    removeSessionRuntime(turnRuntimeRegistry.value, runtimeSessionId);
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
