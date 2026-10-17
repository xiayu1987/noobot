/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  markCurrentTurnArraySummarized,
  markCurrentTurnStoreSummarized,
  mirrorSummarizedMessagesById,
} from "./summary.js";
import { resolveContextMessageId } from "../message/codec.js";
import { isFunction } from "@noobot/shared/value";

export function applyTurnCompletionPolicy({
  modelMessages = [],
  turnMessageStore = null,
  policyOptions = {},
} = {}) {
  if (!turnMessageStore || !isFunction(turnMessageStore.updateWhere)) {
    throw new Error("turn completion policy requires the canonical turn message store");
  }

  const markedMessageIds = new Set();
  const markedCount = markCurrentTurnStoreSummarized(turnMessageStore, {
    policyOptions,
    onMarked: (message) => {
      const id = resolveContextMessageId(message);
      if (id) markedMessageIds.add(id);
    },
  });
  mirrorSummarizedMessagesById(modelMessages, markedMessageIds);
  return {
    markedCount,
    messages: typeof turnMessageStore.toArray === "function" ? turnMessageStore.toArray() : [],
  };
}

export function projectTurnCompletionMessages(messages = [], { policyOptions = {} } = {}) {
  return markCurrentTurnArraySummarized(messages, {
    policyOptions,
  });
}
