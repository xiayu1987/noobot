/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";

export const MODEL_ONLY_MESSAGE_MARKER = "noobotModelOnlyMessage";

export function appendModelOnlyHumanMessage({
  messages = null,
  content = "",
  reason = "",
  metadata = {},
} = {}) {
  if (!Array.isArray(messages)) return null;
  const text = String(content || "");
  if (!text) return null;
  const message = new HumanMessage({
    content: text,
    additional_kwargs: {
      ...metadata,
      [MODEL_ONLY_MESSAGE_MARKER]: true,
      noobotModelOnlyMessageReason: String(reason || "").trim(),
    },
  });
  messages.push(message);
  return message;
}
