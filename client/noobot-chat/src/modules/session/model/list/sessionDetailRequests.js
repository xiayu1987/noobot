/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowMs } from "../../../chat/model/timeFields.js";
import { findSessionByAnyId as findSessionByAnyIdInList } from "../../../chat/model/sessionIdentity.js";
import { normalizeSessionId } from "./sessionIdentity.js";
import { hasCurrentSessionDetail, requireLoadedSessionDetail } from "./sessionRecords.js";
import { thinkingDetailService } from "../../../../infrastructure/api/thinking/thinkingDetailService.js";
import { logWorkflowDiagnostics } from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  isSessionDetailEntryCurrent,
  isAvailableSessionDetailEntry,
  requireSessionDetailDocument,
  selectMainSessionDetailEntry,
  selectSessionDetailBlockingEntry,
} from "@noobot/session-protocol/session-detail";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";
import { observeServerClock } from "../../../chat/model/serverClock.js";

const RECENT_SESSION_DETAIL_REUSE_MS = 2000;

export function createSessionDetailRequests({
  sessions,
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
    const pendingEntry = pendingSessionDetailRequests.get(sessionId);
    const recentMatches =
      recentSessionDetail !== null &&
      isSameSessionIdentity(recentSessionDetail.sessionId, sessionId) &&
      recentSessionDetail.targetSession === targetSession &&
      !targetSession?.detailUnavailableReason &&
      nowMs() - recentSessionDetail.loadedAt <= RECENT_SESSION_DETAIL_REUSE_MS &&
      (targetSession === null ||
        isSessionDetailEntryCurrent(
          selectMainSessionDetailEntry(recentSessionDetail.detail),
          targetSession,
        ));
    return {
      targetSession,
      targetLoaded: targetSession !== null && hasCurrentSessionDetail(targetSession),
      pendingPromise:
        pendingEntry !== undefined &&
        pendingEntry.targetSession === targetSession &&
        pendingEntry.aggregateVersion ===
          (targetSession === null ? null : targetSession.aggregateVersion) &&
        pendingEntry.knownGeneration ===
          (targetSession === null ? null : targetSession.knownGeneration)
          ? pendingEntry.promise
          : null,
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
    if (!force && !requireFresh && reuseRecentlyLoaded && state.recentDetail) {
      return { action: "reuse", detail: state.recentDetail, state, source };
    }
    if (!force && !requireFresh && allowLoadedSnapshot && state.targetLoaded) {
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
    const { ok: _envelopeOk, ...document } = observeServerClock(
      await readApiResponseEnvelope(response),
    );
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
      const targetSession = findSessionByAnyIdInList(sessions.value, requestSessionId);
      if (decision.state.targetSession !== targetSession) {
        throw new TypeError(`session detail request target changed: ${requestSessionId}`);
      }
      if (!data.exists) return data;
      const main = selectMainSessionDetailEntry(data);
      if (
        targetSession !== null &&
        isAvailableSessionDetailEntry(main) &&
        !isSessionDetailEntryCurrent(main, targetSession)
      ) {
        throw new TypeError(
          `session detail version is stale: ${requestSessionId}, received ${main.aggregateVersion}/${main.generation}, required ${targetSession.aggregateVersion}/${targetSession.knownGeneration}`,
        );
      }
      logWorkflowDiagnostics("frontend.workflowDetail.responseReceived", () => ({
        sessionId: data.sessionId,
        requestSource: decision.source,
        sessionDocCount: data.sessions.length,
      }));
      if (selectSessionDetailBlockingEntry(data) === null) {
        if (targetSession !== null) targetSession.knownGeneration = main.generation;
        recentSessionDetail = {
          sessionId: data.sessionId,
          targetSession,
          loadedAt: nowMs(),
          detail: data,
        };
      } else if (recentSessionDetail?.sessionId === requestSessionId) {
        recentSessionDetail = null;
      }
      return data;
    })();

    pendingSessionDetailRequests.set(requestSessionId, {
      promise: requestPromise,
      targetSession: decision.state.targetSession,
      aggregateVersion:
        decision.state.targetSession === null
          ? null
          : decision.state.targetSession.aggregateVersion,
      knownGeneration:
        decision.state.targetSession === null ? null : decision.state.targetSession.knownGeneration,
    });
    try {
      return await requestPromise;
    } finally {
      if (pendingSessionDetailRequests.get(requestSessionId)?.promise === requestPromise) {
        pendingSessionDetailRequests.delete(requestSessionId);
      }
    }
  }

  async function fetchThinkingDetail({
    userId: requestUserId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    cursor = null,
    snapshot = null,
  }) {
    return thinkingDetailService.getPage({
      userId: requestUserId,
      sessionId,
      dialogProcessId,
      turnScopeId,
      cursor,
      snapshot,
    });
  }

  async function releaseThinkingDetail({
    userId: requestUserId,
    sessionId,
    dialogProcessId,
    turnScopeId,
    cursor,
  }) {
    return thinkingDetailService.release({
      userId: requestUserId,
      sessionId,
      dialogProcessId,
      turnScopeId,
      cursor,
    });
  }

  return {
    fetchSessionDetail,
    fetchThinkingDetail,
    releaseThinkingDetail,
  };
}
