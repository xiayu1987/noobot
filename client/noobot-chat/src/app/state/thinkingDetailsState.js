/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole, isAssistantWithoutTurnScope } from "../../modules/chat/model/messageIdentity.js";
import { hasToolTimeline, selectToolTimelineCount } from "../../modules/chat/runtime/engine/toolTimeline.js";

export function getThinkingDetailsCount(messageItem = {}) {
  if (isAssistantWithoutTurnScope(messageItem)) return 0;
  const summaryThinkingDetailsCount = getSummaryThinkingDetailsCount(messageItem);
  if (summaryThinkingDetailsCount > 0) return summaryThinkingDetailsCount;
  if (hasToolTimeline(messageItem)) return selectToolTimelineCount(messageItem);
  const toolCalls = Array.isArray(messageItem?.toolCalls)
    ? messageItem.toolCalls
    : Array.isArray(messageItem?.tool_calls)
    ? messageItem.tool_calls
    : [];
  if (toolCalls.length > 0) {
    return toolCalls.length;
  }
  return 0;
}

function getSummaryThinkingDetailsCount(messageItem = {}) {
  const count = Number(messageItem?.thinkingDetailCount ?? messageItem?.thinking_detail_count);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function hasThinkingDetails(messageItem = {}) {
  return messageItem?.hasThinkingDetails === true || getSummaryThinkingDetailsCount(messageItem) > 0;
}

export function getThinkingDetailsTitle(messageItem = {}, translate) {
  return translate("message.thinkingDetails", { count: getThinkingDetailsCount(messageItem) });
}

export function resolveFallbackThinkingDetailsPayload(activeSession = {}) {
  const messages = activeSession?.messages || [];
  const messageItem = [...messages].reverse().find((item = {}) =>
    getMessageRole(item) === "assistant" &&
    !isAssistantWithoutTurnScope(item) &&
    (item?.pending || hasToolTimeline(item) || hasThinkingDetails(item))
  );
  return { messageItem: messageItem || null, allMessages: messages };
}

export function resolveThinkingDetailsPanelPayload(payload = {}, fallbackPayload = {}) {
  return {
    messageItem: payload?.messageItem || fallbackPayload.messageItem || null,
    allMessages: Array.isArray(payload?.allMessages)
      ? payload.allMessages
      : fallbackPayload.allMessages || [],
  };
}

export function buildThinkingDetailsRoute(sessionId, thinkingDetailsPanel) {
  return {
    sessionId,
    panel: thinkingDetailsPanel,
  };
}
