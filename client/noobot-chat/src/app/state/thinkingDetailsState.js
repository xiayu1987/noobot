/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole, isAssistantWithoutTurnScope } from "../../modules/chat/model/messageIdentity.js";
import { hasToolTimeline } from "../../modules/chat/runtime/engine/toolTimeline.js";
import { selectThinkingDetailCount } from "../../modules/chat/model/thinkingDetailCount.js";

export function getThinkingDetailsCount(messageItem = {}) {
  if (isAssistantWithoutTurnScope(messageItem)) return 0;
  return selectThinkingDetailCount(messageItem);
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
