/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildNormalizedDetailMessages,
  buildTurnStatusesByTurnScopeId,
} from "./detailMessages.js";
import { foldConversationMessages } from "../../../chat/model/messageModel.js";
import { selectTurnPresentations } from "../../../chat/runtime/engine/turnPresentation.js";

export function buildSessionDetailProjection({
  sessionDetail = {},
  sessionDocs = [],
  makeViewMessage,
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
  // A detail snapshot contains canonical model-history entities. Chat display
  // entities are always projected by the same presentation-identity contract
  // used by the live stream; callers cannot bypass this projection.
  const foldedMessages = foldConversationMessages(normalizedMessages, makeViewMessage);
  const projectedMessages = selectTurnPresentations({
    activeSession: {
      sessionId,
      messages: foldedMessages,
      turnStatuses,
    },
  });
  return {
    sessionId,
    messages: projectedMessages,
    turnStatuses,
    turnTimings,
    turnStatusesByTurnScopeId: buildTurnStatusesByTurnScopeId({ turnStatuses }),
  };
}
