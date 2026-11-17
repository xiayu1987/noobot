/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildMessageSummary } from "../session-summary-builders/message-summary-projection.js";

export function buildSessionListFacts({ messageCount, messages }) {
  if (!Number.isSafeInteger(messageCount) || messageCount < 0 || !Array.isArray(messages))
    throw new TypeError("Session list facts require a message count and ordered messages");
  const lastMessage = messages.at(-1);
  if (messageCount > 0 && !lastMessage) {
    const error = new Error("Session list facts require the last ordered message");
    error.code = "SESSION_LIST_FACTS_LAST_MESSAGE_MISSING";
    throw error;
  }
  return {
    messageCount,
    lastMessage: messageCount === 0 ? null : buildMessageSummary(lastMessage),
  };
}
