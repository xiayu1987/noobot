/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildNormalizedDetailMessages,
  buildTurnStatusesByTurnScopeId,
} from "./detailMessages.js";

export function buildSessionDetailProjection({
  sessionDetail = {},
  sessionDocs = [],
  makeViewMessage,
  foldMessagesForView = null,
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
  const normalizedMessages = buildNormalizedDetailMessages({
    detailMessages: messages,
    sessionDocs,
    rootSessionId: sessionId,
    turnTimings,
    turnStatuses,
    makeViewMessage,
  });
  // A detail snapshot is a transport representation.  The display projection
  // must use the same conversation folding contract as the live stream so
  // tool_result records cannot become standalone assistant bubbles.
  const projectedMessages = typeof foldMessagesForView === "function"
    ? foldMessagesForView(normalizedMessages)
    : normalizedMessages;
  return {
    sessionId,
    messages: projectedMessages,
    turnStatuses,
    turnTimings,
    turnStatusesByTurnScopeId: buildTurnStatusesByTurnScopeId({ turnStatuses }),
  };
}
