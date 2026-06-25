/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  appendMessage,
  canonicalizeMessageStore,
  getMessageId,
  replaceMessages,
  resolveMessagesByIds,
  writeMessageBlocks,
} from "../../../../agent/src/system-core/agent/core/message-context/message-store.js";

function isSummarized(message = {}) {
  return message?.summarized === true ||
    message?.lc_kwargs?.summarized === true ||
    message?.additional_kwargs?.summarized === true ||
    message?.lc_kwargs?.additional_kwargs?.summarized === true;
}

function markMessageSummarized(message = null) {
  if (!message || typeof message !== "object") return false;
  if (isSummarized(message)) return false;
  message.summarized = true;
  if (message.lc_kwargs && typeof message.lc_kwargs === "object") {
    message.lc_kwargs.summarized = true;
  }
  return true;
}

export {
  appendMessage,
  canonicalizeMessageStore,
  getMessageId,
  replaceMessages,
  resolveMessagesByIds,
  writeMessageBlocks,
};

export function markSummarized(ctx = {}, ids = []) {
  const messages = resolveMessagesByIds(ctx, ids);
  let changedCount = 0;
  for (const message of messages) {
    if (markMessageSummarized(message)) changedCount += 1;
  }
  return changedCount;
}
