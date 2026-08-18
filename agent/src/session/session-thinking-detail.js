/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  hasThinkingTimeline,
  isInjectedThinkingMessage,
  normalizeThinkingRoute,
  projectThinkingDetailRound,
} from "./thinking-timeline-projection.js";
import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";

export {
  normalizeThinkingRoute as normalizeRouteText,
  isInjectedThinkingMessage as isInjectedMessage,
  hasThinkingTimeline as isToolOrThinkingMessage,
  isMessageInThinkingRound as isSameThinkingRound,
} from "./thinking-timeline-projection.js";

export function buildThinkingDetailPayload(fullResult = {}, filters = {}) {
  const sessions = Array.isArray(fullResult?.sessions) ? fullResult.sessions : [];
  const sessionItem = sessions[0] || {};
  const messages = Array.isArray(sessionItem?.rawMessages)
    ? sessionItem.rawMessages
    : Array.isArray(sessionItem?.messages)
      ? sessionItem.messages
      : [];
  const dialogProcessId = normalizeThinkingRoute(filters.dialogProcessId);
  const turnScopeId = normalizeThinkingRoute(filters.turnScopeId);
  const {
    rootMessage,
    roundMessages,
    toolTimeline,
    activityTimeline,
    projectedRootMessage,
  } = projectThinkingDetailRound(messages, { dialogProcessId, turnScopeId });
  const scopedMessages = roundMessages
    .filter((item = {}) =>
      isInjectedThinkingMessage(item) || hasThinkingTimeline(item) || item === rootMessage,
    )
    .map((item) => item === rootMessage ? projectedRootMessage : item);
  const injectedMessages = scopedMessages.filter((item = {}) => isInjectedThinkingMessage(item));
  const thinkingDetailCount = countCanonicalThinkingDetailEvents({
    toolTimeline,
    activityTimeline,
  });
  const sessionId = fullResult?.sessionId || sessionItem?.sessionId || "";
  const messageItem = {
    ...projectedRootMessage,
    sessionId: normalizeThinkingRoute(rootMessage?.sessionId || sessionId),
    toolTimeline,
    activityTimeline,
    hasThinkingDetails: thinkingDetailCount > 0 || injectedMessages.length > 0,
    thinkingDetailCount,
  };
  return {
    exists: Boolean(rootMessage?.role || scopedMessages.length),
    sessionId,
    revision: normalizeThinkingRoute(fullResult?.revision),
    messageItem,
    counts: {
      executionLogCount: countCanonicalThinkingDetailEvents({ toolTimeline }),
      injectedMessageCount: injectedMessages.length,
      messageCount: scopedMessages.length,
    },
  };
}
