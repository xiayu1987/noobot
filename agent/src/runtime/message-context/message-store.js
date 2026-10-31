/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ToolMessage } from "@langchain/core/messages";
import { appendContextMessage } from "@noobot/context-protocol/mutation/context";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { text, isObjectLike } from "@noobot/shared/value";
import { compactToolResultTextForModel } from "../../transfer-adapter/core/compact.js";

export function appendToolResultModelMessage({
  modelContext,
  toolCallId = "",
  content = "",
  messageUid = "",
  contextPolicy = null,
} = {}) {
  if (!isObjectLike(modelContext)) {
    throw new TypeError("Tool result model message requires the authoritative modelContext");
  }
  const canonicalToolCallId = text(toolCallId);
  const canonicalMessageUid = text(messageUid);
  if (!canonicalToolCallId || !canonicalMessageUid) {
    throw new TypeError("Tool result model message requires toolCallId and messageUid");
  }
  return appendContextMessage(
    modelContext,
    writeContextMessageMetadata(
      new ToolMessage({
        tool_call_id: canonicalToolCallId,
        content: compactToolResultTextForModel(content),
      }),
      { messageUid: canonicalMessageUid, contextPolicy: contextPolicy || undefined },
    ),
    { block: "incremental" },
  );
}
