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
import { isFunction } from "@noobot/shared/value";

export function applyTurnCompletionPolicy({
  modelMessages = [],
  turnMessageStore = null,
  policyOptions = {},
} = {}) {
  if (
    !turnMessageStore ||
    !isFunction(turnMessageStore.updateWhere) ||
    !isFunction(turnMessageStore.toArray)
  ) {
    throw new Error("turn completion policy requires the canonical turn message store");
  }
  const { markedCount, markedMessageIds } = markCurrentTurnStoreSummarized(turnMessageStore, {
    policyOptions,
  });
  mirrorSummarizedMessagesById(modelMessages, markedMessageIds);
  return {
    markedCount,
    messages: turnMessageStore.toArray(),
  };
}

export function projectTurnCompletionMessages(records = [], { policyOptions = {} } = {}) {
  return markCurrentTurnArraySummarized(records, { policyOptions });
}
