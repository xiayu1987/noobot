/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs } from "../../../chat/model/timeFields.js";
import { findSessionByAnyId as findSessionByAnyIdInList } from "../../../chat/model/sessionIdentity.js";
import { normalizeSessionId } from "./sessionIdentity.js";
import { isLoadedRemoteSession, requireLoadedSessionDetail } from "./sessionRecords.js";
import { thinkingDetailService } from "../../../../infrastructure/api/thinking/thinkingDetailService.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { requireSessionDetailDocument } from "@noobot/session-protocol/session-detail";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";

const RECENT_SESSION_DETAIL_REUSE_MS = 2000;

export function createSessionDetailRequests({
  sessions,
  activeSessionId,
  userId,
  authFetch,
  getSessionDetailApi,
  isSameSessionIdentity,
}) {
  let recentSessionDetail = null;
  const pendingSessionDetailRequests = new Map();

  function requireSessionDetailRequestId(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || normalizedSessionId !== sessionId) {
      throw new TypeError(`fetchSessionDetail requires canonical sessionId: ${sessionId}`);
    }
    return normalizedSessionId;
  }

  function requireSessionDetailRequestSource(source) {
    if (typeof source !== "string" || !source || source.trim() !== source) {
      throw new TypeError(`fetchSessionDetail requires canonical source: ${source}`);
    }
    return source;
  }

  function createSessionDetailRequestState(sessionId) {
    const targetSession = findSessionByAnyIdInList(sessions.value, sessionId);
    const activeId = normalizeSessionId(activeSessionId.value);
    const pendingEntry = pendingSessionDetailRequests.get(sessionId);
    const recentMatches =
      recentSessionDetail !== null &&
      isSameSessionIdentity(recentSessionDetail.sessionId, sessionId) &&
      nowMs() - recentSessionDetail.loadedAt <= RECENT_SESSION_DETAIL_REUSE_MS;
    return {
      sessionId,
      activeSessionId: activeId,
      targetSession,
      targetExists: targetSession !== null,
      targetLoaded: targetSession !== null && isLoadedRemoteSession(targetSession),
      sameAsActive: isSameSessionIdentity(sessionId, activeId),
      pendingPromise: pendingEntry === undefined ? null : pendingEntry.promise,
      recentDetail: recentMatches ? recentSessionDetail.detail : null,
    };
  }

  function arbitrateSessionDetailRequest(sessionId, intent) {
    const state = createSessionDetailRequestState(sessionId);
    const source = requireSessionDetailRequestSource(intent.source);
    const force = intent.force === true;
    const requireFresh = intent.requireFresh === true;
    const allowLoadedSnapshot = intent.allowLoadedSnapshot === true;
    const reuseRecentlyLoaded = intent.reuseRecentlyLoaded === true;
    if (state.pendingPromise)
      return { action: "wait", promise: state.pendingPromise, state, source };
    if (!requireFresh && reuseRecentlyLoaded && state.recentDetail) {
      return { action: "reuse", detail: state.recentDetail, state, source };
    }
    if (
      !requireFresh &&
      allowLoadedSnapshot &&
      state.targetLoaded &&
      (!force || state.sameAsActive)
    ) {
      return {
        action: "reuse",
        detail: requireLoadedSessionDetail(state.targetSession),
        state,
        source,
      };
    }
    return { action: "fetch", state, source };
  }

  async function requestSessionDetailData(requestFactory, requestSessionId) {
    const response = await requestFactory();
    const { ok: _envelopeOk, ...document } = await readApiResponseEnvelope(response);
    const data = requireSessionDetailDocument(document);
    if (data.sessionId !== requestSessionId) {
      throw new TypeError(
        `session detail identity mismatch: requested ${requestSessionId}, received ${data.sessionId}`,
      );
    }
    return data;
  }

  async function fetchSessionDetail(sessionId, options) {
    const requestSessionId = requireSessionDetailRequestId(sessionId);
    const decision = arbitrateSessionDetailRequest(requestSessionId, options);
    logWorkflowDiagnostics("frontend.workflowDetail.requestArbitrated", () => ({
      sessionId: requestSessionId,
      requestSource: decision.source,
      action: decision.action,
      force: options.force === true,
      requireFresh: options.requireFresh === true,
    }));
    if (decision.action === "reuse") return decision.detail;
    if (decision.action === "wait") return decision.promise;

    const requestPromise = (async () => {
      const data = await requestSessionDetailData(
        () =>
          getSessionDetailApi(
            { userId: userId.value, sessionId: requestSessionId },
            { fetcher: authFetch },
          ),
        requestSessionId,
      );
      if (!data.exists) return data;
      logWorkflowDiagnostics("frontend.workflowDetail.responseReceived", () => ({
        sessionId: data.sessionId,
        requestSource: decision.source,
        sessionDocCount: data.sessions.length,
      }));
      recentSessionDetail = {
        sessionId: data.sessionId,
        loadedAt: nowMs(),
        detail: data,
      };
      return data;
    })();

    pendingSessionDetailRequests.set(requestSessionId, {
      promise: requestPromise,
      source: decision.source,
      startedAt: nowMs(),
    });
    try {
      return await requestPromise;
    } finally {
      pendingSessionDetailRequests.delete(requestSessionId);
    }
  }

  async function fetchThinkingDetail({ sessionId, dialogProcessId, turnScopeId }) {
    return thinkingDetailService.getDetail({
      userId: userId.value,
      sessionId,
      dialogProcessId,
      turnScopeId,
    });
  }

  return {
    fetchSessionDetail,
    fetchThinkingDetail,
  };
}
