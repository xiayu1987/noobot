/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { getMessageRole, getMessageSessionId, getMessageTurnScopeId } from "./messageIdentity.js";

function requireMessageIndex(messageIndex) {
  if (!Number.isInteger(messageIndex) || messageIndex < 0) {
    throw new TypeError("message_anchor_index_invalid");
  }
  return messageIndex;
}

export function getMessageRenderKey(messageItem, messageIndex) {
  const stableIndex = requireMessageIndex(messageIndex);
  const role = getMessageRole(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const sessionId = getMessageSessionId(messageItem);
  const turnScopeKey = turnScopeId ? `${sessionId || "active"}::${turnScopeId}` : "";
  const taskId = text(messageItem.taskId);
  const toolCallId = text(messageItem.tool_call_id);
  const stablePrimaryId = turnScopeKey || taskId || toolCallId || String(stableIndex);
  return [role, stablePrimaryId, stableIndex]
    .map((item) => String(item).replaceAll("|", "/"))
    .join("|");
}

export function getMessageAnchorId(messageItem, messageIndex) {
  return `chat-message-${getMessageRenderKey(messageItem, messageIndex).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  )}`;
}
