/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildNormalizedDetailMessages } from "./detailMessages.js";
import { foldConversationMessages } from "../../../chat/model/messageModel.js";
import { selectTurnPresentations } from "../../../chat/runtime/engine/turnPresentation.js";
import { text } from "@noobot/shared/value";

export function buildSessionDetailProjection({
  sessionDetail = {},
  sessionDocs = [],
  makeViewMessage,
} = {}) {
  const summary =
    sessionDetail?.sessionSummary && typeof sessionDetail.sessionSummary === "object"
      ? sessionDetail.sessionSummary
      : {};
  const messages = Array.isArray(sessionDetail?.messages)
    ? sessionDetail.messages
    : Array.isArray(summary.messages)
      ? summary.messages
      : [];
  const turnTimings = Array.isArray(sessionDetail?.turnTimings)
    ? sessionDetail.turnTimings
    : Array.isArray(summary.turnTimings)
      ? summary.turnTimings
      : [];
  const sessionId = text(sessionDetail?.sessionId || summary.sessionId);
  const normalizedMessages = buildNormalizedDetailMessages({
    detailMessages: messages,
    sessionDocs,
    rootSessionId: sessionId,
    makeViewMessage,
  });

  const foldedMessages = foldConversationMessages(normalizedMessages, (messageItem) =>
    makeViewMessage(messageItem, { sessionId }),
  );
  const projectedMessages = selectTurnPresentations({
    activeSession: {
      sessionId,
      messages: foldedMessages,
    },
  });
  return {
    sessionId,
    messages: projectedMessages,
    turnTimings,
  };
}
