/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export function buildSessionListFacts({ messageOrder = [], messages = [] } = {}) {
  const lastMessageUid = text(messageOrder.at(-1)?.messageUid);
  if (!lastMessageUid) return { messageCount: 0, lastMessage: null };
  const lastMessage = messages.findLast((message) => message?.messageUid === lastMessageUid);
  if (!lastMessage) {
    const error = new Error("Session list facts require the last ordered message");
    error.code = "SESSION_LIST_FACTS_LAST_MESSAGE_MISSING";
    throw error;
  }
  return { messageCount: messageOrder.length, lastMessage };
}
