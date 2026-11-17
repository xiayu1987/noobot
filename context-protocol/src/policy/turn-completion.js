/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  markCurrentTurnArraySummarized,
  markCurrentTurnStoreSummarized,
  mirrorSummarizedMessagesByUid,
} from "./summary.js";
import { isFunction } from "@noobot/shared/value";

export function applyTurnCompletionPolicy({ modelMessages, turnMessageStore }) {
  if (
    !turnMessageStore ||
    !isFunction(turnMessageStore.updateByUid) ||
    !isFunction(turnMessageStore.readCompletionSelection)
  ) {
    throw new Error("turn completion policy requires the canonical turn message store");
  }
  const { markedCount, markedMessageUids } = markCurrentTurnStoreSummarized(turnMessageStore);
  mirrorSummarizedMessagesByUid(modelMessages, markedMessageUids);
  return { markedCount };
}

export function projectTurnCompletionMessages(records = []) {
  return markCurrentTurnArraySummarized(records);
}
