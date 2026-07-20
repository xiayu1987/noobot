/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildNormalizedDetailMessages,
  buildTurnTimingsByTurnScopeId,
} from "./detailMessages.js";
import { applyCompletedToolLogsToMessages } from "../../infra/sessionToolLogs.js";

/** Single display projection used by both primary and child Agent viewers. */
export function buildSessionDetailProjection({
  sessionDetail = {},
  sessionDocs = [],
  makeViewMessage,
  foldMessagesForView,
  isSummaryDetail = false,
  currentTimingsByTurnScopeId = {},
  onTimingHydrated = null,
  applyToolLogs = false,
  toolSessionDocs = sessionDocs,
} = {}) {
  const summary = sessionDetail?.sessionSummary && typeof sessionDetail.sessionSummary === "object"
    ? sessionDetail.sessionSummary
    : {};
  const messages = Array.isArray(sessionDetail?.messages)
    ? sessionDetail.messages
    : Array.isArray(summary.messages) ? summary.messages : [];
  const turnStatuses = Array.isArray(sessionDetail?.turnStatuses)
    ? sessionDetail.turnStatuses
    : Array.isArray(summary.turnStatuses) ? summary.turnStatuses : [];
  const turnTimings = Array.isArray(sessionDetail?.turnTimings)
    ? sessionDetail.turnTimings
    : Array.isArray(summary.turnTimings) ? summary.turnTimings : [];
  const sessionId = String(sessionDetail?.sessionId || summary.sessionId || "").trim();
  const projectedMessages = buildNormalizedDetailMessages({
    detailMessages: messages,
    sessionDocs,
    rootSessionId: sessionId,
    turnTimings,
    turnStatuses,
    makeViewMessage,
    foldMessagesForView,
    isSummaryDetail,
  });
  if (applyToolLogs) applyCompletedToolLogsToMessages(projectedMessages, toolSessionDocs);
  return {
    sessionId,
    messages: projectedMessages,
    turnStatuses,
    turnTimings,
    turnTimingsByTurnScopeId: buildTurnTimingsByTurnScopeId({
      turnTimings,
      messages,
      currentTimingsByTurnScopeId,
      onTimingHydrated,
    }),
  };
}
