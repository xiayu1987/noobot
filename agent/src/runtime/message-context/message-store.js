/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { ToolMessage } from "@langchain/core/messages";
import { appendContextMessage } from "@noobot/context-protocol/mutation/context";

export function appendToolResultModelMessage({
  modelContext,
  toolCallId = "",
  content = "",
  messageUid = "",
  contextPolicy = null,
} = {}) {
  if (!modelContext || typeof modelContext !== "object") {
    throw new TypeError("Tool result model message requires the authoritative modelContext");
  }
  const canonicalToolCallId = String(toolCallId || "").trim();
  const canonicalMessageUid = String(messageUid || "").trim();
  if (!canonicalToolCallId || !canonicalMessageUid) {
    throw new TypeError("Tool result model message requires toolCallId and messageUid");
  }
  return appendContextMessage(
    modelContext,
    new ToolMessage({
      tool_call_id: canonicalToolCallId,
      content: String(content || ""),
      additional_kwargs: { noobotMessageId: canonicalMessageUid },
      ...(contextPolicy ? { contextPolicy } : {}),
    }),
    { block: "incremental" },
  );
}
