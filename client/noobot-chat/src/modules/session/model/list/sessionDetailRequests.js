/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs } from "../../../chat/model/timeFields.js";
import { findSessionByAnyId as findSessionByAnyIdInList } from "../../../chat/model/sessionIdentity.js";
import { normalizeSessionId } from "./sessionIdentity.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessages,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";

const RECENT_SESSION_DETAIL_REUSE_MS = 2000;

export function createSessionDetailRequests({
  sessions,
  activeSessionId,
  userId,
  authFetch,
  getSessionDetailApi,
  getSessionFullDetailApi = null,
  getSessionThinkingDetailApi = null,
  applySessionDetail,
  isSameSessionIdentity,
  translate,
} = {}) {
  let recentSessionDetail = null;
  const pendingSessionDetailRequests = new Map();

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
      nowMs() - recentSessionDetail.loadedAt <= RECENT_SESSION_DETAIL_REUSE_MS;
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

  async function fetchSessionDetail(sessionId, options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const decision = arbitrateSessionDetailRequest(normalizedSessionId || sessionId, options);
    logWorkflowDiagnostics("frontend.workflowDetail.requestArbitrated", () => ({
      sessionId: normalizedSessionId || sessionId,
      requestSource: decision.source,
      action: decision.action,
      force: options.force === true,
      requireFresh: options.requireFresh === true,
    }));
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
      const sessionDocs = Array.isArray(data?.sessions) ? data.sessions : [];
      const responseMessages = sessionDocs.flatMap((doc = {}) =>
        Array.isArray(doc?.messages) ? doc.messages : []);
      logWorkflowDiagnostics("frontend.workflowDetail.responseReceived", () => ({
        sessionId: normalizeSessionId(data.sessionId || normalizedSessionId || sessionId),
        requestSource: decision.source,
        summary: data?.summary === true,
        sessionDocCount: sessionDocs.length,
        messageCount: responseMessages.length,
        workflowCandidates: summarizeWorkflowMessages(responseMessages),
        workflowRuntimeEventCount: Array.isArray(data?.workflowRuntimeEvents)
          ? data.workflowRuntimeEvents.length
          : 0,
      }));
      recentSessionDetail = {
        sessionId: normalizeSessionId(data.sessionId || normalizedSessionId || sessionId),
        loadedAt: nowMs(),
        detail: data,
      };
      return data;
    })();

    pendingSessionDetailRequests.set(normalizedSessionId || sessionId, {
      promise: requestPromise,
      source: decision.source,
      startedAt: nowMs(),
    });
    try {
      return await requestPromise;
    } finally {
      pendingSessionDetailRequests.delete(normalizedSessionId || sessionId);
    }
  }

  async function fetchSessionFullDetail(sessionId, options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (typeof getSessionFullDetailApi !== "function") {
      throw new TypeError("full Session Detail API is unavailable");
    }
    logWorkflowDiagnostics("frontend.workflowDetail.fullRequestStarted", () => ({
      sessionId: normalizedSessionId || sessionId,
      requestSource: normalizeSessionId(options.source || options.reason || "full-detail"),
    }));
    const res = await getSessionFullDetailApi(
      { userId: userId.value, sessionId: normalizedSessionId || sessionId },
      { fetcher: authFetch },
    );
    if (!res.ok) throw new Error(translate("chat.getSessionFailed", { status: res.status }));
    const data = await res.json();
    if (!data.ok || !data.exists) throw new Error(data.error || translate("chat.sessionNotFound"));
    const sessionDocs = Array.isArray(data?.sessions) ? data.sessions : [];
    const responseMessages = sessionDocs.flatMap((doc = {}) =>
      Array.isArray(doc?.messages) ? doc.messages : []);
    const rawMessageCount = sessionDocs.reduce(
      (count, doc = {}) => count + (Array.isArray(doc?.rawMessages) ? doc.rawMessages.length : 0),
      0,
    );
    logWorkflowDiagnostics("frontend.workflowDetail.fullResponseReceived", () => ({
      sessionId: normalizeSessionId(data.sessionId || normalizedSessionId || sessionId),
      requestSource: normalizeSessionId(options.source || options.reason || "full-detail"),
      sessionDocCount: sessionDocs.length,
      messageCount: responseMessages.length,
      rawMessageCount,
      detailMode: String(data?.detailMode || ""),
      schemaVersions: sessionDocs.map((doc = {}) => Number(doc?.schemaVersion || 0)),
      workflowCandidates: summarizeWorkflowMessages(responseMessages),
      workflowRuntimeEventCount: Array.isArray(data?.workflowRuntimeEvents)
        ? data.workflowRuntimeEvents.length
        : 0,
    }));
    applySessionDetail(data, options);
    return data;
  }

  async function fetchThinkingDetail(sessionId, { dialogProcessId = "", turnScopeId = "" } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedDialogProcessId = String(dialogProcessId || "").trim();
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!normalizedDialogProcessId && !normalizedTurnScopeId) {
      throw new Error("dialogProcessId or turnScopeId is required");
    }
    if (typeof getSessionThinkingDetailApi !== "function") {
      throw new Error("thinking detail api is unavailable");
    }
    const res = await getSessionThinkingDetailApi(
      {
        userId: userId.value,
        sessionId: normalizedSessionId || sessionId,
        dialogProcessId: normalizedDialogProcessId,
        turnScopeId: normalizedTurnScopeId,
      },
      { fetcher: authFetch },
    );
    if (!res.ok) throw new Error(translate("chat.getSessionFailed", { status: res.status }));
    const data = await res.json();
    if (!data.ok || !data.exists) throw new Error(data.error || translate("chat.sessionNotFound"));
    return data;
  }

  return {
    fetchSessionDetail,
    fetchSessionFullDetail,
    fetchThinkingDetail,
  };
}
